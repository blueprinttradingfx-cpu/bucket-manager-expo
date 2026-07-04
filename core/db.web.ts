// core/db.web.ts
// IndexedDB implementation of BucketStoreAPI, via the 'idb' wrapper library.
// Metro resolves any import of './db' to THIS file automatically on web.
// IndexedDB has no SQL UNIQUE constraint, so dedup is done explicitly via
// a compound index lookup before each insert - same guarantee as SQLite's
// UNIQUE(bucket_id, row_hash), just implemented by hand.

import { openDB, IDBPDatabase } from 'idb';
import {
  RawRow, StoredTxn, prepareRows, computeHoldings, Holding,
  computeBucketPositions, aggregateAcrossBuckets, computePortfolioSummary,
  AggregatedStock, BucketStockPosition, PortfolioSummary,
} from './bucketLogic';
import { BucketRow, BucketStoreAPI } from './storeApi';

const DB_NAME = 'bucket_portfolio';
const DB_VERSION = 1;

interface StoredBucket { id: number; name: string; yield_low: number | null; yield_high: number | null; }
interface StoredWebTxn extends StoredTxn { id?: number; bucketId: number; }

async function openBucketDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const buckets = db.createObjectStore('buckets', { keyPath: 'id', autoIncrement: true });
      buckets.createIndex('by_name', 'name', { unique: true });

      const txns = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
      txns.createIndex('by_bucket', 'bucketId');
      txns.createIndex('by_bucket_hash', ['bucketId', 'rowHash'], { unique: true });
    },
  });
}

export class WebBucketStore implements BucketStoreAPI {
  private constructor(private db: IDBPDatabase) {}

  static async create(): Promise<WebBucketStore> {
    return new WebBucketStore(await openBucketDB());
  }

  async getOrCreateBucket(name: string, yieldLow?: number, yieldHigh?: number): Promise<number> {
    const existing = (await this.db.getFromIndex('buckets', 'by_name', name)) as StoredBucket | undefined;
    if (existing) return existing.id;
    const id = await this.db.add('buckets', {
      name, yield_low: yieldLow ?? null, yield_high: yieldHigh ?? null,
    } as any);
    return id as number;
  }

  async listBuckets(): Promise<BucketRow[]> {
    const all = await this.db.getAll('buckets') as StoredBucket[];
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async importIntoBucket(bucketName: string, rows: RawRow[]) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const prepared = prepareRows(rows);

    let inserted = 0, skipped = 0;
    const tx = this.db.transaction('transactions', 'readwrite');
    const index = tx.store.index('by_bucket_hash');
    for (const t of prepared) {
      const dupe = await index.get([bucketId, t.rowHash]);
      if (dupe) { skipped++; continue; }
      await tx.store.add({ bucketId, ...t } as any);
      inserted++;
    }
    await tx.done;
    return { inserted, skippedDuplicates: skipped };
  }

  async getBucketHoldings(bucketName: string) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    const relevant: StoredTxn[] = all.filter(
      (t) => (t.Type === 'BUY' || t.Type === 'SELL') && t.Quantity != null
    );
    return computeHoldings(relevant);
  }

  async getAllHoldings(): Promise<(Holding & { bucket: string })[]> {
    const buckets = await this.listBuckets();
    const out: (Holding & { bucket: string })[] = [];
    for (const b of buckets) {
      const { holdings } = await this.getBucketHoldings(b.name);
      for (const h of holdings) out.push({ ...h, bucket: b.name });
    }
    return out;
  }

  private async getBucketTxns(bucketName: string): Promise<StoredTxn[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    return all.filter(
      (t) => (t.Type === 'BUY' || t.Type === 'SELL' || t.Type === 'CASH DIVIDEND')
    );
  }

  async getBucketPositions(bucketName: string): Promise<BucketStockPosition[]> {
    const txns = await this.getBucketTxns(bucketName);
    const { positions } = computeBucketPositions(bucketName, txns);
    return positions;
  }

  private async getAllPositions(): Promise<BucketStockPosition[]> {
    const buckets = await this.listBuckets();
    let all: BucketStockPosition[] = [];
    for (const b of buckets) {
      all = all.concat(await this.getBucketPositions(b.name));
    }
    return all;
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    return computePortfolioSummary(await this.getAllPositions());
  }

  async getAggregatedStocks(): Promise<AggregatedStock[]> {
    return aggregateAcrossBuckets(await this.getAllPositions());
  }

  async getDividendHistory(bucketName: string, ticker: string): Promise<{ date: string; amount: number }[]> {
    const txns = await this.getBucketTxns(bucketName);
    return txns
      .filter((t) => t.Type === 'CASH DIVIDEND' && t.Stock === ticker)
      .map((t) => ({ date: t.isoDate, amount: t.Amount ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
