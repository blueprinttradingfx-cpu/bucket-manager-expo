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
      is_manual INTEGER DEFAULT 0,
      UNIQUE(bucket_id, row_hash),
      FOREIGN KEY(bucket_id) REFERENCES buckets(id)
    );
  `);

  // Migration: add is_manual column if it doesn't exist (for existing databases)
  const columns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(transactions)"
  );
  const hasIsManual = columns.some((c) => c.name === 'is_manual');
  if (!hasIsManual) {
    await db.execAsync('ALTER TABLE transactions ADD COLUMN is_manual INTEGER DEFAULT 0');
  }
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

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null }): Promise<void> {
    const current = await this.db.getFirstAsync<BucketRow>(
      'SELECT id, name, yield_low, yield_high FROM buckets WHERE id = ?', id
    );
    if (!current) throw new Error(`Bucket ${id} not found`);
    const name = updates.name ?? current.name;
    const yieldLow = updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low;
    const yieldHigh = updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high;
    await this.db.runAsync(
      'UPDATE buckets SET name = ?, yield_low = ?, yield_high = ? WHERE id = ?',
      name, yieldLow, yieldHigh, id
    );
  }

  async deleteBucket(id: number): Promise<void> {
    const holdings = await this.db.getAllAsync<{ bucket_id: number }>(
      'SELECT DISTINCT bucket_id FROM transactions WHERE bucket_id = ?',
      id
    );
    if (holdings.length > 0) {
      throw new Error('Cannot delete bucket with existing holdings');
    }
    await this.db.runAsync('DELETE FROM buckets WHERE id = ?', id);
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
   *  needed since dividends live in the same table but aren't lots. Also pulls
   *  description, used to classify stocks vs. funds. */
  private async getBucketTxns(bucketName: string): Promise<StoredTxn[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const rows = await this.db.getAllAsync<any>(
      `SELECT date as Date, type as Type, stock as Stock, description as Description,
              quantity as Quantity, price as Price, fees as [Comm & Other Fees], amount as Amount
       FROM transactions WHERE bucket_id = ? AND type IN ('BUY','SELL','CASH DIVIDEND')
       ORDER BY date`,
      bucketId
    );
    return rows.map((r: any) => ({
      ...r, Currency: null, rowHash: '', isoDate: r.Date,
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

  async getTransactionHistory(bucketName: string, ticker: string): Promise<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    return this.db.getAllAsync<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }>(
      `SELECT date, type, quantity, price, amount FROM transactions
       WHERE bucket_id = ? AND type IN ('BUY', 'SELL') AND stock = ?
       ORDER BY date`,
      bucketId, ticker
    );
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
    const result = await this.db.runAsync(
      `INSERT INTO transactions
       (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash, is_manual)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, 1)`,
      bucketId, date, type, stock, quantity ?? null, price ?? null, amount ?? null, `manual_${Date.now()}_${Math.random()}`
    );
    return result.lastInsertRowId;
  }

  async deleteManualTransaction(transactionId: number): Promise<void> {
    const txn = await this.db.getFirstAsync<{ is_manual: number }>(
      'SELECT is_manual FROM transactions WHERE id = ?',
      transactionId
    );
    if (!txn) throw new Error('Transaction not found');
    if (txn.is_manual !== 1) throw new Error('Can only delete manually added transactions');
    await this.db.runAsync('DELETE FROM transactions WHERE id = ?', transactionId);
  }

  async updateManualTransaction(
    transactionId: number,
    updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null }
  ): Promise<void> {
    const txn = await this.db.getFirstAsync<{ is_manual: number }>(
      'SELECT is_manual FROM transactions WHERE id = ?',
      transactionId
    );
    if (!txn) throw new Error('Transaction not found');
    if (txn.is_manual !== 1) throw new Error('Can only update manually added transactions');

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.date !== undefined) {
      fields.push('date = ?');
      values.push(updates.date);
    }
    if (updates.quantity !== undefined) {
      fields.push('quantity = ?');
      values.push(updates.quantity);
    }
    if (updates.price !== undefined) {
      fields.push('price = ?');
      values.push(updates.price);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }

    if (fields.length === 0) return;

    values.push(transactionId);
    await this.db.runAsync(
      `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`,
      ...values
    );
  }

  async getManualTransactions(bucketName: string): Promise<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    return this.db.getAllAsync<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }>(
      `SELECT id, date, type, stock, quantity, price, amount FROM transactions
       WHERE bucket_id = ? AND is_manual = 1
       ORDER BY date DESC`,
      bucketId
    );
  }
}
