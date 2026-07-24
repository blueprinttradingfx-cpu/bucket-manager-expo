// core/db.native.ts
// SQLite implementation of BucketStoreAPI. Metro resolves any import of
// './db' to THIS file automatically on iOS/Android (the .native.ts suffix
// is a Metro convention, not a manual import path). Logic is unchanged from
// the original db.ts - just reshaped into a class matching the shared
// interface so screens can be platform-agnostic.

import { SQLiteDatabase } from 'expo-sqlite';
import {
  RawRow, StoredTxn, prepareRows, computeHoldings, Holding,
  computeBucketPositions, aggregateAcrossBuckets, computePortfolioSummary, summarizeStockHistory,
  AggregatedStock, BucketStockPosition, PortfolioSummary, RealizedTrade, FundFill,
} from './bucketLogic';
import {
  BucketRow, BucketStoreAPI, WatchlistItem, WatchlistImportResult, SyncSnapshot, RestoreResult,
  SyncBucketRecord, SyncTransactionRecord, SyncWatchlistRecord, SyncSettingsRecord,
} from './storeApi';
import { PortfolioStockInput, dedupePortfolioStocks, mergeBuyBelowPrice } from './watchlistImport';
import { generateUuid } from './uuid';

/** Adds a column via ALTER TABLE if it isn't already there - the standard
 *  SQLite migration pattern for evolving a schema across app updates
 *  without wiping existing on-device data. */
async function addColumnIfMissing(db: SQLiteDatabase, table: string, column: string, decl: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value REAL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      ticker TEXT PRIMARY KEY,
      buy_below_price REAL,
      added_at TEXT NOT NULL
    );
  `);

  // Migration: add is_manual column if it doesn't exist (for existing databases)
  await addColumnIfMissing(db, 'transactions', 'is_manual', 'INTEGER DEFAULT 0');

  // --- Sync prep (sync-plan.md §1, §4 Phase 0) ---
  // buckets/transactions get a stable cross-device uuid; every synced store
  // gets updated_at (so a future push can tell what's dirty); buckets/
  // transactions/watchlist get deleted_at as a soft-delete tombstone slot -
  // NOT wired into delete operations yet (deletes below are still hard
  // deletes). Respecting deleted_at is Phase 4 sync-engine work, not schema
  // prep - this just avoids a second migration when that phase lands.
  await addColumnIfMissing(db, 'buckets', 'uuid', 'TEXT');
  await addColumnIfMissing(db, 'buckets', 'updated_at', 'TEXT');
  await addColumnIfMissing(db, 'buckets', 'deleted_at', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'uuid', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'updated_at', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'deleted_at', 'TEXT');
  await addColumnIfMissing(db, 'watchlist', 'updated_at', 'TEXT');
  await addColumnIfMissing(db, 'watchlist', 'deleted_at', 'TEXT');
  await addColumnIfMissing(db, 'settings', 'updated_at', 'TEXT');

  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_buckets_uuid ON buckets(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_uuid ON transactions(uuid);
  `);

  // Backfill: rows that existed before this migration have uuid/updated_at
  // NULL post-ALTER TABLE. Give every one a uuid and a same-instant
  // updated_at now, once, so nothing is left un-syncable.
  const now = new Date().toISOString();
  const staleBuckets = await db.getAllAsync<{ id: number }>('SELECT id FROM buckets WHERE uuid IS NULL');
  for (const b of staleBuckets) {
    await db.runAsync('UPDATE buckets SET uuid = ?, updated_at = ? WHERE id = ?', generateUuid(), now, b.id);
  }
  const staleTxns = await db.getAllAsync<{ id: number }>('SELECT id FROM transactions WHERE uuid IS NULL');
  for (const t of staleTxns) {
    await db.runAsync('UPDATE transactions SET uuid = ?, updated_at = ? WHERE id = ?', generateUuid(), now, t.id);
  }
  await db.runAsync('UPDATE watchlist SET updated_at = ? WHERE updated_at IS NULL', now);
  await db.runAsync('UPDATE settings SET updated_at = ? WHERE updated_at IS NULL', now);
}

export class NativeBucketStore implements BucketStoreAPI {
  constructor(private db: SQLiteDatabase) {}

  async getOrCreateBucket(name: string, yieldLow?: number, yieldHigh?: number): Promise<number> {
    const existing = await this.db.getFirstAsync<{ id: number; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM buckets WHERE name = ?', name
    );
    if (existing) {
      // name is UNIQUE, so a soft-deleted bucket (Phase 4, sync-plan.md
      // §10a) permanently occupies its name unless revived here - without
      // this, re-creating/importing into a previously-deleted bucket name
      // would hit the UNIQUE constraint instead of just working.
      if (existing.deleted_at) {
        await this.db.runAsync(
          'UPDATE buckets SET deleted_at = NULL, updated_at = ? WHERE id = ?',
          new Date().toISOString(), existing.id
        );
      }
      return existing.id;
    }
    const result = await this.db.runAsync(
      'INSERT INTO buckets (name, yield_low, yield_high, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
      name, yieldLow ?? null, yieldHigh ?? null, generateUuid(), new Date().toISOString()
    );
    return result.lastInsertRowId;
  }

  async listBuckets(): Promise<BucketRow[]> {
    return this.db.getAllAsync<BucketRow>(
      'SELECT id, name, yield_low, yield_high FROM buckets WHERE deleted_at IS NULL ORDER BY sort_order, name'
    );
  }

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null }): Promise<void> {
    const current = await this.db.getFirstAsync<BucketRow>(
      'SELECT id, name, yield_low, yield_high FROM buckets WHERE id = ? AND deleted_at IS NULL', id
    );
    if (!current) throw new Error(`Bucket ${id} not found`);
    const name = updates.name ?? current.name;
    const yieldLow = updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low;
    const yieldHigh = updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high;
    await this.db.runAsync(
      'UPDATE buckets SET name = ?, yield_low = ?, yield_high = ?, updated_at = ? WHERE id = ?',
      name, yieldLow, yieldHigh, new Date().toISOString(), id
    );
  }

  async deleteBucket(id: number): Promise<void> {
    // Excludes already-tombstoned transactions - a bucket whose only
    // transactions are soft-deleted has no real holdings left and
    // shouldn't be stuck permanently behind this guard (Phase 4,
    // sync-plan.md §10a).
    const holdings = await this.db.getAllAsync<{ bucket_id: number }>(
      'SELECT DISTINCT bucket_id FROM transactions WHERE bucket_id = ? AND deleted_at IS NULL',
      id
    );
    if (holdings.length > 0) {
      throw new Error('Cannot delete bucket with existing holdings');
    }
    // Soft delete (Phase 4, sync-plan.md §10a): a tombstone, not a real
    // DELETE, so the deletion itself can sync instead of being silently
    // un-deleted by a stale pull from another device.
    const now = new Date().toISOString();
    await this.db.runAsync('UPDATE buckets SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  }

  async importIntoBucket(bucketName: string, rows: RawRow[]) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const prepared: StoredTxn[] = prepareRows(rows);

    let inserted = 0, skipped = 0;
    const importedAt = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      for (const t of prepared) {
        try {
          await this.db.runAsync(
            `INSERT INTO transactions
             (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash, uuid, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            bucketId, t.isoDate, t.Type, t.Stock, t.Description,
            t.Quantity, t.Price, t['Comm & Other Fees'], t.Currency, t.Amount, t.rowHash,
            generateUuid(), importedAt
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
         AND deleted_at IS NULL
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
    const perBucket = await Promise.all(
      buckets.map(async (b) => {
        const { holdings } = await this.getBucketHoldings(b.name);
        return holdings.map((h) => ({ ...h, bucket: b.name }));
      })
    );
    return perBucket.flat();
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
         AND deleted_at IS NULL
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

  async getBucketPositionForTicker(bucketName: string, ticker: string): Promise<BucketStockPosition | null> {
    const txns = await this.getBucketTxns(bucketName);
    const { positions, closedPositions } = computeBucketPositions(bucketName, txns);
    return positions.find((p) => p.ticker === ticker) ?? closedPositions.find((p) => p.ticker === ticker) ?? null;
  }

  private async getAllPositions(): Promise<BucketStockPosition[]> {
    const buckets = await this.listBuckets();
    const perBucket = await Promise.all(buckets.map((b) => this.getBucketPositions(b.name)));
    return perBucket.flat();
  }

  private async getAllBucketSummaries(): Promise<{ positions: BucketStockPosition[]; totalRealizedGain: number; totalDividends: number }> {
    const buckets = await this.listBuckets();
    const perBucket = await Promise.all(
      buckets.map(async (b) => {
        const txns = await this.getBucketTxns(b.name);
        return computeBucketPositions(b.name, txns);
      })
    );
    return {
      positions: perBucket.flatMap((r) => r.positions),
      totalRealizedGain: perBucket.reduce((s, r) => s + r.totalRealizedGain, 0),
      totalDividends: perBucket.reduce((s, r) => s + r.totalDividends, 0),
    };
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    const { positions, totalRealizedGain, totalDividends } = await this.getAllBucketSummaries();
    return computePortfolioSummary(positions, totalRealizedGain, totalDividends);
  }

  async getAggregatedStocks(): Promise<AggregatedStock[]> {
    return aggregateAcrossBuckets(await this.getAllPositions());
  }

  async getStockHistory(ticker: string): Promise<AggregatedStock | null> {
    const buckets = await this.listBuckets();
    const perBucket = await Promise.all(
      buckets.map(async (b) => {
        const txns = await this.getBucketTxns(b.name);
        const { positions, closedPositions } = computeBucketPositions(b.name, txns);
        return [...positions, ...closedPositions].filter((p) => p.ticker === ticker);
      })
    );
    return summarizeStockHistory(ticker, perBucket.flat());
  }

  /** Every CASH DIVIDEND transaction, either portfolio-wide (bucketName
   *  omitted) or scoped to one bucket - powers the Monthly Dividend Income
   *  chart/screen. Oldest first. */
  async getDividendFeed(bucketName?: string): Promise<{ date: string; ticker: string; amount: number; bucket: string }[]> {
    const rows = bucketName
      ? await this.db.getAllAsync<{ date: string; ticker: string; amount: number | null; bucket: string }>(
          `SELECT t.date as date, t.stock as ticker, t.amount as amount, b.name as bucket
           FROM transactions t JOIN buckets b ON b.id = t.bucket_id
           WHERE b.name = ? AND t.type = 'CASH DIVIDEND' AND t.stock IS NOT NULL
             AND t.deleted_at IS NULL
           ORDER BY t.date`,
          bucketName
        )
      : await this.db.getAllAsync<{ date: string; ticker: string; amount: number | null; bucket: string }>(
          `SELECT t.date as date, t.stock as ticker, t.amount as amount, b.name as bucket
           FROM transactions t JOIN buckets b ON b.id = t.bucket_id
           WHERE t.type = 'CASH DIVIDEND' AND t.stock IS NOT NULL
             AND t.deleted_at IS NULL
           ORDER BY t.date`
        );
    return rows.map((r) => ({ ...r, amount: r.amount ?? 0 }));
  }

  /** All-time dividends + realized gains for a bucket, including tickers that
   *  are now fully exited (and so no longer appear in getBucketPositions). */
  async getBucketLifetimeTotals(bucketName: string): Promise<{ totalRealizedGain: number; totalDividends: number; trades: RealizedTrade[] }> {
    const txns = await this.getBucketTxns(bucketName);
    const { realizedTrades, totalRealizedGain, totalDividends } = computeBucketPositions(bucketName, txns);
    return { totalRealizedGain, totalDividends, trades: realizedTrades };
  }

  async getBucketTransactionFeed(bucketName: string): Promise<{ date: string; type: string; ticker: string; quantity: number | null; price: number | null; amount: number | null }[]> {
    const txns = await this.getBucketTxns(bucketName);
    return txns
      .filter((t) => t.Stock != null)
      .map((t) => ({ date: t.isoDate, type: t.Type, ticker: t.Stock!, quantity: t.Quantity, price: t.Price, amount: t.Amount }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDividendHistory(bucketName: string, ticker: string): Promise<{ date: string; amount: number }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    return this.db.getAllAsync<{ date: string; amount: number }>(
      `SELECT date, amount FROM transactions
       WHERE bucket_id = ? AND type = 'CASH DIVIDEND' AND stock = ?
         AND deleted_at IS NULL
       ORDER BY date`,
      bucketId, ticker
    );
  }

  async getTransactionHistory(bucketName: string, ticker: string): Promise<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const rows = await this.db.getAllAsync<{ date: string; type: 'BUY' | 'SELL'; quantity: number | null; price: number | null; amount: number | null }>(
      `SELECT date, type, quantity, price, amount FROM transactions
       WHERE bucket_id = ? AND type IN ('BUY', 'SELL') AND stock = ?
         AND deleted_at IS NULL
       ORDER BY date`,
      bucketId, ticker
    );
    return rows.map((r) => ({ ...r, quantity: r.quantity ?? 0, price: r.price ?? 0, amount: r.amount ?? 0 }));
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
       (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash, is_manual, uuid, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)`,
      bucketId, date, type, stock, quantity ?? null, price ?? null, amount ?? null, `manual_${Date.now()}_${Math.random()}`,
      generateUuid(), new Date().toISOString()
    );
    return result.lastInsertRowId;
  }

  async deleteManualTransaction(transactionId: number): Promise<void> {
    const txn = await this.db.getFirstAsync<{ is_manual: number }>(
      'SELECT is_manual FROM transactions WHERE id = ? AND deleted_at IS NULL',
      transactionId
    );
    if (!txn) throw new Error('Transaction not found');
    if (txn.is_manual !== 1) throw new Error('Can only delete manually added transactions');
    // Soft delete (Phase 4, sync-plan.md §10a) - see deleteBucket for why.
    const now = new Date().toISOString();
    await this.db.runAsync('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, transactionId);
  }

  async updateManualTransaction(
    transactionId: number,
    updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null }
  ): Promise<void> {
    const txn = await this.db.getFirstAsync<{ is_manual: number }>(
      'SELECT is_manual FROM transactions WHERE id = ? AND deleted_at IS NULL',
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

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

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
       WHERE bucket_id = ? AND is_manual = 1 AND deleted_at IS NULL
       ORDER BY date DESC`,
      bucketId
    );
  }

  /** Fund BUY rows (imported or manual), pending or settled - see FundFill. */
  async getFundFills(bucketName: string): Promise<FundFill[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    return this.db.getAllAsync<FundFill>(
      `SELECT id, date, stock, description, amount, quantity, price FROM transactions
       WHERE bucket_id = ? AND type = 'BUY' AND stock IS NOT NULL AND amount IS NOT NULL
         AND description LIKE '%fund%' AND deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
      bucketId
    );
  }

  async updateFundTransaction(transactionId: number, quantity: number, price: number): Promise<void> {
    const txn = await this.db.getFirstAsync<{ id: number; type: string }>(
      'SELECT id, type FROM transactions WHERE id = ? AND deleted_at IS NULL',
      transactionId
    );
    if (!txn) throw new Error('Transaction not found');
    if (txn.type !== 'BUY') throw new Error('Can only set units/price on a BUY transaction');
    await this.db.runAsync(
      'UPDATE transactions SET quantity = ?, price = ?, updated_at = ? WHERE id = ?',
      quantity, price, new Date().toISOString(), transactionId
    );
  }

  async getMonthlyIncomeGoal(): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ value: number }>(
      "SELECT value FROM settings WHERE key = 'monthlyIncomeGoal'"
    );
    return row?.value ?? null;
  }

  async setMonthlyIncomeGoal(goal: number | null): Promise<void> {
    if (goal == null) {
      await this.db.runAsync("DELETE FROM settings WHERE key = 'monthlyIncomeGoal'");
    } else {
      await this.db.runAsync(
        "INSERT INTO settings (key, value, updated_at) VALUES ('monthlyIncomeGoal', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        goal, new Date().toISOString()
      );
    }
  }

  // Encoded as a number in the same (key TEXT, value REAL) settings table
  // used above: 0 = system, 1 = light, 2 = dark.
  async getThemeMode(): Promise<'system' | 'light' | 'dark'> {
    const row = await this.db.getFirstAsync<{ value: number }>(
      "SELECT value FROM settings WHERE key = 'themeMode'"
    );
    return (['system', 'light', 'dark'] as const)[row?.value ?? 0] ?? 'system';
  }

  async setThemeMode(mode: 'system' | 'light' | 'dark'): Promise<void> {
    const value = { system: 0, light: 1, dark: 2 }[mode];
    await this.db.runAsync(
      "INSERT INTO settings (key, value, updated_at) VALUES ('themeMode', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      value, new Date().toISOString()
    );
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    const rows = await this.db.getAllAsync<{ ticker: string; buy_below_price: number | null; added_at: string }>(
      'SELECT ticker, buy_below_price, added_at FROM watchlist WHERE deleted_at IS NULL ORDER BY added_at DESC'
    );
    return rows.map((r) => ({ ticker: r.ticker, buyBelowPrice: r.buy_below_price, addedAt: r.added_at }));
  }

  async addToWatchlist(ticker: string): Promise<void> {
    const now = new Date().toISOString();
    // ticker is the PRIMARY KEY, so a soft-deleted ticker (Phase 4,
    // sync-plan.md §10a) permanently occupies its row unless revived here -
    // same reasoning as getOrCreateBucket. A live row is left untouched
    // (existing "no-op if already watched" behavior).
    const existing = await this.db.getFirstAsync<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM watchlist WHERE ticker = ?', ticker
    );
    if (existing) {
      if (existing.deleted_at) {
        await this.db.runAsync(
          'UPDATE watchlist SET buy_below_price = NULL, deleted_at = NULL, added_at = ?, updated_at = ? WHERE ticker = ?',
          now, now, ticker
        );
      }
      return;
    }
    await this.db.runAsync(
      'INSERT INTO watchlist (ticker, buy_below_price, added_at, updated_at) VALUES (?, NULL, ?, ?)',
      ticker, now, now
    );
  }

  async removeFromWatchlist(ticker: string): Promise<void> {
    // Soft delete (Phase 4, sync-plan.md §10a) - see deleteBucket for why.
    const now = new Date().toISOString();
    await this.db.runAsync('UPDATE watchlist SET deleted_at = ?, updated_at = ? WHERE ticker = ?', now, now, ticker);
  }

  async setWatchlistBuyBelowPrice(ticker: string, price: number | null): Promise<void> {
    const existing = await this.db.getFirstAsync<{ ticker: string }>(
      'SELECT ticker FROM watchlist WHERE ticker = ? AND deleted_at IS NULL', ticker
    );
    if (!existing) throw new Error(`${ticker} is not on the watchlist`);
    await this.db.runAsync(
      'UPDATE watchlist SET buy_below_price = ?, updated_at = ? WHERE ticker = ?',
      price, new Date().toISOString(), ticker
    );
  }

  async importPortfolioIntoWatchlist(stocks: PortfolioStockInput[]): Promise<WatchlistImportResult> {
    const merged = dedupePortfolioStocks(stocks);
    let added = 0, loweredPrice = 0, unchanged = 0;
    await this.db.withTransactionAsync(async () => {
      for (const stock of merged) {
        const existing = await this.db.getFirstAsync<{ buy_below_price: number | null; deleted_at: string | null }>(
          'SELECT buy_below_price, deleted_at FROM watchlist WHERE ticker = ?', stock.ticker
        );
        if (!existing) {
          const now = new Date().toISOString();
          await this.db.runAsync(
            'INSERT INTO watchlist (ticker, buy_below_price, added_at, updated_at) VALUES (?, ?, ?, ?)',
            stock.ticker, stock.buyBelowPrice, now, now
          );
          added++;
          continue;
        }
        if (existing.deleted_at) {
          // Revive (Phase 4, sync-plan.md §10a) - same reasoning as
          // addToWatchlist. Treated as a fresh add, not a price merge,
          // since the ticker wasn't actually live on the watchlist.
          const now = new Date().toISOString();
          await this.db.runAsync(
            'UPDATE watchlist SET buy_below_price = ?, deleted_at = NULL, added_at = ?, updated_at = ? WHERE ticker = ?',
            stock.buyBelowPrice, now, now, stock.ticker
          );
          added++;
          continue;
        }
        const nextPrice = mergeBuyBelowPrice(existing.buy_below_price, stock.buyBelowPrice);
        if (nextPrice !== existing.buy_below_price) {
          await this.db.runAsync(
            'UPDATE watchlist SET buy_below_price = ?, updated_at = ? WHERE ticker = ?',
            nextPrice, new Date().toISOString(), stock.ticker
          );
          loweredPrice++;
        } else {
          unchanged++;
        }
      }
    });
    return { added, loweredPrice, unchanged };
  }

  async getSyncSnapshot(): Promise<SyncSnapshot> {
    const buckets = await this.db.getAllAsync<{
      uuid: string; name: string; yield_low: number | null; yield_high: number | null;
      sort_order: number; updated_at: string; deleted_at: string | null;
    }>('SELECT uuid, name, yield_low, yield_high, sort_order, updated_at, deleted_at FROM buckets');

    // Transactions carry the owning bucket's UUID (not bucket_id) - joined
    // here since only the uuid is safe to write cross-device.
    const txns = await this.db.getAllAsync<{
      uuid: string; bucket_uuid: string; date: string | null; type: string | null; stock: string | null;
      description: string | null; quantity: number | null; price: number | null; fees: number | null;
      currency: string | null; amount: number | null; row_hash: string; is_manual: number;
      updated_at: string; deleted_at: string | null;
    }>(`SELECT t.uuid, b.uuid as bucket_uuid, t.date, t.type, t.stock, t.description,
               t.quantity, t.price, t.fees, t.currency, t.amount, t.row_hash, t.is_manual,
               t.updated_at, t.deleted_at
        FROM transactions t JOIN buckets b ON b.id = t.bucket_id`);

    const watchlist = await this.db.getAllAsync<{
      ticker: string; buy_below_price: number | null; added_at: string;
      updated_at: string; deleted_at: string | null;
    }>('SELECT ticker, buy_below_price, added_at, updated_at, deleted_at FROM watchlist');

    const settingsRows = await this.db.getAllAsync<{ key: string; value: number; updated_at: string | null }>(
      'SELECT key, value, updated_at FROM settings'
    );
    const goalRow = settingsRows.find((r) => r.key === 'monthlyIncomeGoal');
    const themeRow = settingsRows.find((r) => r.key === 'themeMode');
    const settingsUpdatedAt = [goalRow?.updated_at, themeRow?.updated_at]
      .filter((v): v is string => !!v).sort().pop() ?? new Date().toISOString();

    return {
      buckets: buckets.map((b) => ({
        uuid: b.uuid, name: b.name, yieldLow: b.yield_low, yieldHigh: b.yield_high,
        sortOrder: b.sort_order, updatedAt: b.updated_at, deletedAt: b.deleted_at,
      })),
      transactions: txns.map((t) => ({
        uuid: t.uuid, bucketUuid: t.bucket_uuid, date: t.date, type: t.type, stock: t.stock,
        description: t.description, quantity: t.quantity, price: t.price, fees: t.fees,
        currency: t.currency, amount: t.amount, rowHash: t.row_hash, isManual: t.is_manual === 1,
        updatedAt: t.updated_at, deletedAt: t.deleted_at,
      })),
      watchlist: watchlist.map((w) => ({
        ticker: w.ticker, buyBelowPrice: w.buy_below_price, addedAt: w.added_at,
        updatedAt: w.updated_at, deletedAt: w.deleted_at,
      })),
      settings: {
        monthlyIncomeGoal: goalRow?.value ?? null,
        themeMode: (['system', 'light', 'dark'] as const)[themeRow?.value ?? 0] ?? 'system',
        updatedAt: settingsUpdatedAt,
      },
    };
  }

  // lastSyncedAt reuses the (key TEXT, value REAL) settings table like
  // monthlyIncomeGoal/themeMode above - value is REAL-only, so the ISO
  // string is stored as epoch milliseconds rather than adding a new column
  // type just for this.
  async getLastSyncedAt(): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: number }>(
      "SELECT value FROM settings WHERE key = 'lastSyncedAt'"
    );
    return row ? new Date(row.value).toISOString() : null;
  }

  async setLastSyncedAt(iso: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO settings (key, value, updated_at) VALUES ('lastSyncedAt', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      Date.parse(iso), iso
    );
  }

  async hasAnyLocalData(): Promise<boolean> {
    // Excludes tombstones (Phase 4, sync-plan.md §10a) - a device with only
    // soft-deleted rows has nothing live to protect, and should be treated
    // the same as a genuinely empty device by the Phase 3 restore flow.
    const bucket = await this.db.getFirstAsync<{ id: number }>('SELECT id FROM buckets WHERE deleted_at IS NULL LIMIT 1');
    if (bucket) return true;
    const watchlistItem = await this.db.getFirstAsync<{ ticker: string }>('SELECT ticker FROM watchlist WHERE deleted_at IS NULL LIMIT 1');
    return !!watchlistItem;
  }

  // Phase 3 (sync-plan.md §5/§8): one-way pull, clean overwrite rather than
  // a merge - step 3 of the sync engine (conflict resolution) isn't needed
  // for v1. Wrapped in a single withTransactionAsync so it's atomic: if any
  // insert fails partway through, SQLite rolls back the whole thing,
  // including the DELETEs at the top, leaving local data exactly as it was
  // before the restore was attempted rather than half-overwritten.
  async restoreFromSyncSnapshot(snapshot: SyncSnapshot): Promise<RestoreResult> {
    let bucketsWritten = 0, transactionsWritten = 0, watchlistWritten = 0;

    await this.db.withTransactionAsync(async () => {
      await this.db.execAsync('DELETE FROM transactions; DELETE FROM buckets; DELETE FROM watchlist;');

      // Buckets first, so bucketUuid -> local integer id resolves before
      // transactions (which reference bucket_id, not bucketUuid) are inserted.
      const bucketUuidToId = new Map<string, number>();
      for (const b of snapshot.buckets) {
        if (b.deletedAt) continue; // tombstone - not wired into any UI yet (Phase 0), but skip defensively
        const result = await this.db.runAsync(
          'INSERT INTO buckets (name, yield_low, yield_high, sort_order, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          b.name, b.yieldLow, b.yieldHigh, b.sortOrder, b.uuid, b.updatedAt
        );
        bucketUuidToId.set(b.uuid, result.lastInsertRowId);
        bucketsWritten++;
      }

      for (const t of snapshot.transactions) {
        if (t.deletedAt) continue;
        const bucketId = bucketUuidToId.get(t.bucketUuid);
        if (bucketId == null) continue; // orphaned - referenced bucket wasn't in this snapshot, skip rather than throw
        await this.db.runAsync(
          `INSERT INTO transactions
           (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash, is_manual, uuid, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          bucketId, t.date, t.type, t.stock, t.description, t.quantity, t.price, t.fees,
          t.currency, t.amount, t.rowHash, t.isManual ? 1 : 0, t.uuid, t.updatedAt
        );
        transactionsWritten++;
      }

      for (const w of snapshot.watchlist) {
        if (w.deletedAt) continue;
        await this.db.runAsync(
          'INSERT INTO watchlist (ticker, buy_below_price, added_at, updated_at) VALUES (?, ?, ?, ?)',
          w.ticker, w.buyBelowPrice, w.addedAt, w.updatedAt
        );
        watchlistWritten++;
      }

      // Only the two settings keys that are actually part of a synced
      // snapshot - lastSyncedAt and hasCompletedInitialRestore live in this
      // same (key, value) table but describe THIS device's own sync
      // history, not synced data, so a restore must never touch them.
      if (snapshot.settings.monthlyIncomeGoal == null) {
        await this.db.runAsync("DELETE FROM settings WHERE key = 'monthlyIncomeGoal'");
      } else {
        await this.db.runAsync(
          "INSERT INTO settings (key, value, updated_at) VALUES ('monthlyIncomeGoal', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          snapshot.settings.monthlyIncomeGoal, snapshot.settings.updatedAt
        );
      }
      const themeValue = { system: 0, light: 1, dark: 2 }[snapshot.settings.themeMode];
      await this.db.runAsync(
        "INSERT INTO settings (key, value, updated_at) VALUES ('themeMode', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        themeValue, snapshot.settings.updatedAt
      );
    });

    return { bucketsWritten, transactionsWritten, watchlistWritten, settingsRestored: true };
  }

  async getHasCompletedInitialRestore(): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ value: number }>(
      "SELECT value FROM settings WHERE key = 'hasCompletedInitialRestore'"
    );
    return row?.value === 1;
  }

  async setHasCompletedInitialRestore(value: boolean): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO settings (key, value, updated_at) VALUES ('hasCompletedInitialRestore', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      value ? 1 : 0, new Date().toISOString()
    );
  }

  // --- Phase 4 (sync-plan.md §10b): per-record upsert -----------------
  // See storeApi.ts's BucketStoreAPI doc comment for the contract these
  // implement. uuid isn't a SQLite PRIMARY KEY here (the local integer id
  // still is, for joins/ordering - sync-plan.md §1), so "insert or update by
  // uuid" is a SELECT-then-branch rather than a single upsert statement,
  // same pattern getOrCreateBucket already uses for its own lookup.

  async applySyncedBucket(record: SyncBucketRecord): Promise<void> {
    const existing = await this.db.getFirstAsync<{ id: number }>(
      'SELECT id FROM buckets WHERE uuid = ?', record.uuid
    );
    if (existing) {
      await this.db.runAsync(
        'UPDATE buckets SET name = ?, yield_low = ?, yield_high = ?, sort_order = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
        record.name, record.yieldLow, record.yieldHigh, record.sortOrder, record.updatedAt, record.deletedAt, existing.id
      );
      return;
    }
    // New to this device. name is UNIQUE - see the "known gap" note on
    // applySyncedBucket in storeApi.ts for the cross-device name-collision
    // case this doesn't attempt to resolve.
    await this.db.runAsync(
      'INSERT INTO buckets (name, yield_low, yield_high, sort_order, uuid, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      record.name, record.yieldLow, record.yieldHigh, record.sortOrder, record.uuid, record.updatedAt, record.deletedAt
    );
  }

  async applySyncedTransaction(record: SyncTransactionRecord): Promise<void> {
    const bucket = await this.db.getFirstAsync<{ id: number }>(
      'SELECT id FROM buckets WHERE uuid = ?', record.bucketUuid
    );
    if (!bucket) return; // orphaned - see storeApi.ts doc comment

    const existing = await this.db.getFirstAsync<{ id: number }>(
      'SELECT id FROM transactions WHERE uuid = ?', record.uuid
    );
    if (existing) {
      await this.db.runAsync(
        `UPDATE transactions SET bucket_id = ?, date = ?, type = ?, stock = ?, description = ?,
           quantity = ?, price = ?, fees = ?, currency = ?, amount = ?, row_hash = ?, is_manual = ?,
           updated_at = ?, deleted_at = ? WHERE id = ?`,
        bucket.id, record.date, record.type, record.stock, record.description,
        record.quantity, record.price, record.fees, record.currency, record.amount,
        record.rowHash, record.isManual ? 1 : 0, record.updatedAt, record.deletedAt, existing.id
      );
      return;
    }
    await this.db.runAsync(
      `INSERT INTO transactions
       (bucket_id, date, type, stock, description, quantity, price, fees, currency, amount, row_hash, is_manual, uuid, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bucket.id, record.date, record.type, record.stock, record.description,
      record.quantity, record.price, record.fees, record.currency, record.amount,
      record.rowHash, record.isManual ? 1 : 0, record.uuid, record.updatedAt, record.deletedAt
    );
  }

  async applySyncedWatchlistItem(record: SyncWatchlistRecord): Promise<void> {
    const existing = await this.db.getFirstAsync<{ ticker: string }>(
      'SELECT ticker FROM watchlist WHERE ticker = ?', record.ticker
    );
    if (existing) {
      await this.db.runAsync(
        'UPDATE watchlist SET buy_below_price = ?, added_at = ?, updated_at = ?, deleted_at = ? WHERE ticker = ?',
        record.buyBelowPrice, record.addedAt, record.updatedAt, record.deletedAt, record.ticker
      );
      return;
    }
    await this.db.runAsync(
      'INSERT INTO watchlist (ticker, buy_below_price, added_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)',
      record.ticker, record.buyBelowPrice, record.addedAt, record.updatedAt, record.deletedAt
    );
  }

  async applySyncedSettings(record: SyncSettingsRecord): Promise<void> {
    // Same (key, value) settings table + ON CONFLICT upsert pattern as
    // setMonthlyIncomeGoal/setThemeMode above - a null goal means "cleared,"
    // matching setMonthlyIncomeGoal's own null-means-delete behavior rather
    // than storing a NULL value row.
    if (record.monthlyIncomeGoal == null) {
      await this.db.runAsync("DELETE FROM settings WHERE key = 'monthlyIncomeGoal'");
    } else {
      await this.db.runAsync(
        "INSERT INTO settings (key, value, updated_at) VALUES ('monthlyIncomeGoal', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        record.monthlyIncomeGoal, record.updatedAt
      );
    }
    const themeValue = { system: 0, light: 1, dark: 2 }[record.themeMode];
    await this.db.runAsync(
      "INSERT INTO settings (key, value, updated_at) VALUES ('themeMode', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      themeValue, record.updatedAt
    );
  }
}
