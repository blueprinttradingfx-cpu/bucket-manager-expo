// core/db.native.ts
// SQLite implementation of BucketStoreAPI. Metro resolves any import of
// './db' to THIS file automatically on iOS/Android (the .native.ts suffix
// is a Metro convention, not a manual import path). Logic is unchanged from
// the original db.ts - just reshaped into a class matching the shared
// interface so screens can be platform-agnostic.

import { SQLiteDatabase } from 'expo-sqlite';
import {
  RawRow, StoredTxn, prepareRows, computeHoldings, Holding,
  computeBucketPositions, aggregateAcrossBuckets, computePortfolioSummary,
  AggregatedStock, BucketStockPosition, PortfolioSummary,
} from './bucketLogic';
import { BucketRow, BucketStoreAPI } from './storeApi';

export async function initSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS buckets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      yield_low REAL,
      yield_high REAL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_id INTEGER NOT NULL,
      date TEXT, type TEXT, stock TEXT, description TEXT,
      quantity REAL, price REAL, fees REAL, currency TEXT, amount REAL,
      row_hash TEXT NOT NULL,
      UNIQUE(bucket_id, row_hash),
      FOREIGN KEY(bucket_id) REFERENCES buckets(id)
    );
  `);
}

export class NativeBucketStore implements BucketStoreAPI {
  constructor(private db: SQLiteDatabase) {}

  async getOrCreateBucket(name: string, yieldLow?: number, yieldHigh?: number): Promise<number> {
    const existing = await this.db.getFirstAsync<{ id: number }>(
      'SELECT id FROM buckets WHERE name = ?', name
    );
    if (existing) return existing.id;
    const result = await this.db.runAsync(
      'INSERT INTO buckets (name, yield_low, yield_high) VALUES (?, ?, ?)',
      name, yieldLow ?? null, yieldHigh ?? null
    );
    return result.lastInsertRowId;
  }

  async listBuckets(): Promise<BucketRow[]> {
    return this.db.getAllAsync<BucketRow>(
      'SELECT id, name, yield_low, yield_high FROM buckets ORDER BY sort_order, name'
    );
  }

  async importIntoBucket(bucketName: string, rows: RawRow[]) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const prepared: StoredTxn[] = prepareRows(rows);

    let inserted = 0, skipped = 0;
    await this.db.withTransactionAsync(async () => {
      for (const t of prepared) {
        try {
          await this.db.runAsync(
            `INSERT INTO transactions
             (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            bucketId, t.isoDate, t.Type, t.Stock, t.Description,
            t.Quantity, t.Price, t['Comm & Other Fees'], t.Currency, t.Amount, t.rowHash
          );
          inserted++;
        } catch (e: any) {
          if (String(e?.message ?? e).includes('UNIQUE')) skipped++;
          else throw e;
        }
      }
    });
    return { inserted, skippedDuplicates: skipped };
  }

  async getBucketHoldings(bucketName: string) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const rows = await this.db.getAllAsync<any>(
      `SELECT date as Date, type as Type, stock as Stock, quantity as Quantity,
              price as Price, fees as [Comm & Other Fees]
       FROM transactions WHERE bucket_id = ? AND type IN ('BUY','SELL') AND quantity IS NOT NULL
       ORDER BY date`,
      bucketId
    );
    const asStored: StoredTxn[] = rows.map((r: any) => ({
      ...r, Description: null, Currency: null, Amount: null,
      rowHash: '', isoDate: r.Date,
    }));
    return computeHoldings(asStored);
  }

  async getAllHoldings(): Promise<(Holding & { bucket: string })[]> {
    const buckets = await this.listBuckets();
    const all: (Holding & { bucket: string })[] = [];
    for (const b of buckets) {
      const { holdings } = await this.getBucketHoldings(b.name);
      for (const h of holdings) all.push({ ...h, bucket: b.name });
    }
    return all;
  }

  /** Fetches ALL relevant transaction types (not just BUY/SELL) for one bucket -
   *  needed since dividends live in the same table but aren't lots. */
  private async getBucketTxns(bucketName: string): Promise<StoredTxn[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const rows = await this.db.getAllAsync<any>(
      `SELECT date as Date, type as Type, stock as Stock, quantity as Quantity,
              price as Price, fees as [Comm & Other Fees], amount as Amount
       FROM transactions WHERE bucket_id = ? AND type IN ('BUY','SELL','CASH DIVIDEND')
       ORDER BY date`,
      bucketId
    );
    return rows.map((r: any) => ({
      ...r, Description: null, Currency: null, rowHash: '', isoDate: r.Date,
    }));
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
    const bucketId = await this.getOrCreateBucket(bucketName);
    return this.db.getAllAsync<{ date: string; amount: number }>(
      `SELECT date, amount FROM transactions
       WHERE bucket_id = ? AND type = 'CASH DIVIDEND' AND stock = ?
       ORDER BY date`,
      bucketId, ticker
    );
  }
}
