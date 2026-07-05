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
const DB_VERSION = 2;

interface StoredBucket { id: number; name: string; yield_low: number | null; yield_high: number | null; }
interface StoredWebTxn extends StoredTxn { id?: number; bucketId: number; isManual?: number; }

async function openBucketDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      // Create object stores only if they don't exist (for new databases)
      if (!db.objectStoreNames.contains('buckets')) {
        const buckets = db.createObjectStore('buckets', { keyPath: 'id', autoIncrement: true });
        buckets.createIndex('by_name', 'name', { unique: true });
      }

      if (!db.objectStoreNames.contains('transactions')) {
        const txns = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        txns.createIndex('by_bucket', 'bucketId');
        txns.createIndex('by_bucket_hash', ['bucketId', 'rowHash'], { unique: true });
      }

      // Migration: add isManual field to existing transactions (version 1 -> 2)
      if (oldVersion < 2 && db.objectStoreNames.contains('transactions')) {
        // IndexedDB doesn't support ALTER TABLE, but we can add new properties to existing records
        // The isManual field will be added automatically when we update records
        // No action needed - the field will be undefined for existing records and we handle that in the code
      }
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

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null }): Promise<void> {
    const current = await this.db.get('buckets', id) as StoredBucket | undefined;
    if (!current) throw new Error(`Bucket ${id} not found`);
    const updated: StoredBucket = {
      id,
      name: updates.name ?? current.name,
      yield_low: updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low,
      yield_high: updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high,
    };
    await this.db.put('buckets', updated);
  }

  async deleteBucket(id: number): Promise<void> {
    const txns = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', id) as StoredWebTxn[];
    if (txns.length > 0) {
      throw new Error('Cannot delete bucket with existing holdings');
    }
    await this.db.delete('buckets', id);
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

  async getTransactionHistory(bucketName: string, ticker: string): Promise<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }[]> {
    const txns = await this.getBucketTxns(bucketName);
    return txns
      .filter((t) => (t.Type === 'BUY' || t.Type === 'SELL') && t.Stock === ticker)
      .map((t) => ({
        date: t.isoDate,
        type: t.Type as 'BUY' | 'SELL',
        quantity: t.Quantity ?? 0,
        price: t.Price ?? 0,
        amount: t.Amount ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async addManualTransaction(
    bucketName: string,
    type: 'BUY' | 'SELL' | 'CASH DIVIDEND',
    stock: string,
    date: string,
    quantity?: number,
    price?: number,
    amount?: number
  ): Promise<number> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const id = await this.db.add('transactions', {
      bucketId,
      Type: type,
      Stock: stock,
      Date: date,
      isoDate: date,
      Quantity: quantity ?? null,
      Price: price ?? null,
      Amount: amount ?? null,
      Description: null,
      Currency: null,
      rowHash: `manual_${Date.now()}_${Math.random()}`,
      isManual: 1,
    } as any);
    return id as number;
  }

  async deleteManualTransaction(transactionId: number): Promise<void> {
    const txn = await this.db.get('transactions', transactionId) as StoredWebTxn | undefined;
    if (!txn) throw new Error('Transaction not found');
    if (txn.isManual !== 1) throw new Error('Can only delete manually added transactions');
    await this.db.delete('transactions', transactionId);
  }

  async updateManualTransaction(
    transactionId: number,
    updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null }
  ): Promise<void> {
    const txn = await this.db.get('transactions', transactionId) as StoredWebTxn | undefined;
    if (!txn) throw new Error('Transaction not found');
    if (txn.isManual !== 1) throw new Error('Can only update manually added transactions');

    if (updates.date !== undefined) {
      txn.Date = updates.date;
      txn.isoDate = updates.date;
    }
    if (updates.quantity !== undefined) txn.Quantity = updates.quantity;
    if (updates.price !== undefined) txn.Price = updates.price;
    if (updates.amount !== undefined) txn.Amount = updates.amount;

    await this.db.put('transactions', txn);
  }

  async getManualTransactions(bucketName: string): Promise<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    return all
      .filter((t) => t.isManual === 1 && t.Stock != null)
      .map((t) => ({
        id: t.id!,
        date: t.isoDate,
        type: t.Type,
        stock: t.Stock!,
        quantity: t.Quantity ?? null,
        price: t.Price ?? null,
        amount: t.Amount ?? null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}