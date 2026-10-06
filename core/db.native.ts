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
  SyncBucketRecord, SyncTransactionRecord, SyncWatchlistRecord, SyncSettingsRecord, SyncStockNoteRecord,
  StockNote, StockTagAssignment, SyncStockTagRecord, StockAlert, StockTrackerEntry, WeeklyMacdTrend, ForeignFlowSentiment,
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
    CREATE TABLE IF NOT EXISTS stock_notes (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      content_html TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_notes_ticker ON stock_notes(ticker);

    CREATE TABLE IF NOT EXISTS stock_tags (
      ticker TEXT NOT NULL,
      tag TEXT NOT NULL,
      assigned_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      PRIMARY KEY (ticker, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_tags_ticker ON stock_tags(ticker);
    CREATE INDEX IF NOT EXISTS idx_stock_tags_tag ON stock_tags(tag);

    CREATE TABLE IF NOT EXISTS stock_alerts (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      event_date TEXT,
      event_time TEXT,
      reminder_timing TEXT,
      price_direction TEXT,
      price_threshold REAL,
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      last_triggered_at TEXT,
      last_triggered_value TEXT,
      last_checked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_alerts_ticker ON stock_alerts(ticker);
    CREATE INDEX IF NOT EXISTS idx_stock_alerts_updated_at ON stock_alerts(updated_at);

    CREATE TABLE IF NOT EXISTS stock_tracker (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      area_price_of_interest TEXT NOT NULL DEFAULT '',
      weekly_macd_trend TEXT NOT NULL DEFAULT 'none',
      weekly_macd_trend_custom TEXT,
      foreign_flow_sentiment TEXT NOT NULL DEFAULT 'unknown',
      event_catalyst TEXT NOT NULL DEFAULT '',
      projection TEXT NOT NULL DEFAULT '',
      notes TEXT,
      price_alert_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_tracker_ticker ON stock_tracker(ticker);
    CREATE INDEX IF NOT EXISTS idx_stock_tracker_updated_at ON stock_tracker(updated_at);
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
  // User-chosen swatch for identifying this bucket across the app - see
  // BucketRow.color's doc comment in storeApi.ts. NULL (the default for
  // every pre-existing row post-ALTER TABLE, and for a newly-created
  // bucket that hasn't had a color set) means "derive one instead" -
  // no backfill needed, unlike uuid/updated_at above.
  await addColumnIfMissing(db, 'buckets', 'color', 'TEXT');
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
      'SELECT id, name, yield_low, yield_high, color FROM buckets WHERE deleted_at IS NULL ORDER BY sort_order, name'
    );
  }

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null; color?: string | null }): Promise<void> {
    const current = await this.db.getFirstAsync<BucketRow>(
      'SELECT id, name, yield_low, yield_high, color FROM buckets WHERE id = ? AND deleted_at IS NULL', id
    );
    if (!current) throw new Error(`Bucket ${id} not found`);
    const name = updates.name ?? current.name;
    const yieldLow = updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low;
    const yieldHigh = updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high;
    const color = updates.color !== undefined ? updates.color : current.color;
    await this.db.runAsync(
      'UPDATE buckets SET name = ?, yield_low = ?, yield_high = ?, color = ?, updated_at = ? WHERE id = ?',
      name, yieldLow, yieldHigh, color, new Date().toISOString(), id
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

  async getStockNotes(ticker: string): Promise<StockNote[]> {
    const rows = await this.db.getAllAsync<{ id: string; ticker: string; content_html: string; created_at: string; updated_at: string }>(
      'SELECT id, ticker, content_html, created_at, updated_at FROM stock_notes WHERE ticker = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      ticker
    );
    return rows.map((r) => ({ id: r.id, ticker: r.ticker, contentHtml: r.content_html, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async listAllStockNotes(ticker?: string): Promise<StockNote[]> {
    const sql = ticker !== undefined && ticker.length > 0
      ? 'SELECT id, ticker, content_html, created_at, updated_at FROM stock_notes WHERE ticker = ? AND deleted_at IS NULL ORDER BY created_at DESC'
      : 'SELECT id, ticker, content_html, created_at, updated_at FROM stock_notes WHERE deleted_at IS NULL ORDER BY created_at DESC';
    const rows = await this.db.getAllAsync<{ id: string; ticker: string; content_html: string; created_at: string; updated_at: string }>(
      sql,
      ...(ticker !== undefined && ticker.length > 0 ? [ticker] : [])
    );
    return rows.map((r) => ({ id: r.id, ticker: r.ticker, contentHtml: r.content_html, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async addStockNote(ticker: string, contentHtml: string): Promise<StockNote> {
    const id = generateUuid();
    const now = new Date().toISOString();
    await this.db.runAsync(
      'INSERT INTO stock_notes (id, ticker, content_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id, ticker, contentHtml, now, now
    );
    return { id, ticker, contentHtml, createdAt: now, updatedAt: now };
  }

  async updateStockNote(id: string, contentHtml: string): Promise<void> {
    const existing = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM stock_notes WHERE id = ? AND deleted_at IS NULL', id
    );
    if (!existing) throw new Error('This note no longer exists.');
    await this.db.runAsync(
      'UPDATE stock_notes SET content_html = ?, updated_at = ? WHERE id = ?',
      contentHtml, new Date().toISOString(), id
    );
  }

  async deleteStockNote(id: string): Promise<void> {
    // Soft delete (same tombstone convention as buckets/watchlist) - see
    // SyncStockNoteRecord's doc comment.
    const now = new Date().toISOString();
    await this.db.runAsync('UPDATE stock_notes SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  }

  async getTagsForTicker(ticker: string): Promise<StockTagAssignment[]> {
    const rows = await this.db.getAllAsync<{
      ticker: string; tag: string; assigned_at: string; updated_at: string; deleted_at: string | null;
    }>(
      'SELECT ticker, tag, assigned_at, updated_at, deleted_at FROM stock_tags WHERE ticker = ? AND deleted_at IS NULL ORDER BY assigned_at DESC',
      ticker
    );
    return rows.map((r) => ({
      ticker: r.ticker, tag: r.tag,
      assignedAt: r.assigned_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null,
    }));
  }

  /** Normalize one tag value before writing it to storage - mirrors what the
   *  UI layer does (trim, collapse whitespace, prepend "#" if missing). Done
   *  here too so callers that write tags through non-UI paths (restore from
   *  sync, manual programmatic calls) still end up with consistent storage. */
  private normalizeTagValue(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return '';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }

  async setTagsForTicker(ticker: string, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    // Normalize each value, drop any that normalize to empty, then dedupe
    // (user could accidentally pass "#foo" and "foo" separately); keep
    // first occurrence order.
    const seen = new Set<string>();
    const target: string[] = [];
    for (const t of tags) {
      const norm = this.normalizeTagValue(t);
      if (norm.length === 0) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      target.push(norm);
    }

    await this.db.withTransactionAsync(async () => {
      // Fetch every existing row for this ticker INCLUDING tombstoned ones
      // - we need to know the original assignedAt for revivals (don't reset
      // it just because the tag was removed and re-added later), plus we
      // need the set to diff against for inserts/updates/deletes.
      const existing = await this.db.getAllAsync<{
        tag: string; assigned_at: string; updated_at: string; deleted_at: string | null;
      }>('SELECT tag, assigned_at, updated_at, deleted_at FROM stock_tags WHERE ticker = ?', ticker);
      const existingMap = new Map(existing.map((r) => [r.tag, r]));

      // 1. Every incoming tag: INSERT if new, or REVIVE if tombstoned, or leave as-is if live
      for (const tag of target) {
        const ex = existingMap.get(tag);
        if (!ex) {
          await this.db.runAsync(
            'INSERT INTO stock_tags (ticker, tag, assigned_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
            ticker, tag, now, now
          );
        } else if (ex.deleted_at != null) {
          // Revive the tombstone. Keep the original assignedAt; only bump updatedAt.
          await this.db.runAsync(
            'UPDATE stock_tags SET deleted_at = NULL, updated_at = ? WHERE ticker = ? AND tag = ?',
            now, ticker, tag
          );
        } else {
          // Already live and not changed - no write needed (preserves LWW
          // timestamp ordering across devices for identical sets).
        }
      }

      // 2. Every currently-LIVE existing tag that is NOT in the incoming set: soft-delete.
      const keep = new Set(target);
      for (const ex of existing) {
        if (ex.deleted_at != null) continue;
        if (!keep.has(ex.tag)) {
          await this.db.runAsync(
            'UPDATE stock_tags SET deleted_at = ?, updated_at = ? WHERE ticker = ? AND tag = ?',
            now, now, ticker, ex.tag
          );
        }
      }
    });
  }

  async getAllTagsWithCounts(): Promise<{ tag: string; tickerCount: number; mostRecentAssignedAt: string }[]> {
    // SQLite GROUP BY rollup: count of DISTINCT live tickers per tag, with
    // most-recent assignedAt for ordering tiebreaks. Excludes pairs whose
    // deleted_at IS NOT NULL via the WHERE clause (so a tag whose every
    // assignment is tombstoned yields no rows and vanishes entirely).
    const rows = await this.db.getAllAsync<{
      tag: string; ticker_count: number; most_recent: string;
    }>(`
      SELECT tag, COUNT(DISTINCT ticker) AS ticker_count, MAX(assigned_at) AS most_recent
      FROM stock_tags
      WHERE deleted_at IS NULL
      GROUP BY tag
      ORDER BY ticker_count DESC, most_recent DESC
    `);
    return rows.map((r) => ({ tag: r.tag, tickerCount: r.ticker_count, mostRecentAssignedAt: r.most_recent }));
  }

  async getTickersForTag(tag: string): Promise<(StockTagAssignment & { ticker: string })[]> {
    const rows = await this.db.getAllAsync<{
      ticker: string; tag: string; assigned_at: string; updated_at: string; deleted_at: string | null;
    }>(
      'SELECT ticker, tag, assigned_at, updated_at, deleted_at FROM stock_tags WHERE tag = ? AND deleted_at IS NULL ORDER BY assigned_at DESC',
      tag
    );
    return rows.map((r) => ({
      ticker: r.ticker, tag: r.tag,
      assignedAt: r.assigned_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null,
    }));
  }

  // --- Stock alerts -------------------------------------------------------

  private rowToAlert(r: {
    id: string; ticker: string; type: string; title: string;
    event_date: string | null; event_time: string | null; reminder_timing: string | null;
    price_direction: string | null; price_threshold: number | null;
    email: string; status: string;
    created_at: string; updated_at: string; deleted_at: string | null;
    last_triggered_at: string | null; last_triggered_value: string | null; last_checked_at: string | null;
  }): StockAlert {
    return {
      id: r.id, ticker: r.ticker,
      type: r.type as 'event' | 'price',
      title: r.title,
      eventDate: r.event_date, eventTime: r.event_time,
      reminderTiming: r.reminder_timing as StockAlert['reminderTiming'],
      priceDirection: r.price_direction as 'above' | 'below' | null,
      priceThreshold: r.price_threshold,
      email: r.email, status: r.status as 'active' | 'paused',
      createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
      lastTriggeredAt: r.last_triggered_at,
      lastTriggeredValue: r.last_triggered_value,
      lastCheckedAt: r.last_checked_at,
    };
  }

  async getAlertsForTicker(ticker: string): Promise<StockAlert[]> {
    const rows = await this.db.getAllAsync<Parameters<NativeBucketStore['rowToAlert']>[0]>(
      `SELECT id, ticker, type, title, event_date, event_time, reminder_timing,
              price_direction, price_threshold, email, status, created_at, updated_at,
              deleted_at, last_triggered_at, last_triggered_value, last_checked_at
       FROM stock_alerts WHERE ticker = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      ticker
    );
    return rows.map((r) => this.rowToAlert(r));
  }

  async addStockAlert(alert: Omit<StockAlert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<StockAlert> {
    const id = generateUuid();
    const now = new Date().toISOString();
    await this.db.runAsync(
      `INSERT INTO stock_alerts
       (id, ticker, type, title, event_date, event_time, reminder_timing,
        price_direction, price_threshold, email, status, created_at, updated_at, deleted_at,
        last_triggered_at, last_triggered_value, last_checked_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
      id, alert.ticker, alert.type, alert.title, alert.eventDate ?? null,
      alert.eventTime ?? null, alert.reminderTiming ?? null,
      alert.priceDirection ?? null, alert.priceThreshold ?? null,
      alert.email, alert.status, now, now,
      alert.lastTriggeredAt ?? null,
      alert.lastTriggeredValue != null ? String(alert.lastTriggeredValue) : null,
      alert.lastCheckedAt ?? null
    );
    return { ...alert, id, createdAt: now, updatedAt: now, deletedAt: null };
  }

  async updateStockAlert(
    id: string,
    updates: Partial<Pick<StockAlert, 'title' | 'eventDate' | 'eventTime' | 'reminderTiming' | 'priceDirection' | 'priceThreshold' | 'email' | 'status'>>
  ): Promise<void> {
    const existing = await this.db.getFirstAsync<Parameters<NativeBucketStore['rowToAlert']>[0]>(
      `SELECT id, ticker, type, title, event_date, event_time, reminder_timing,
              price_direction, price_threshold, email, status, created_at, updated_at,
              deleted_at, last_triggered_at, last_triggered_value, last_checked_at
       FROM stock_alerts WHERE id = ? AND deleted_at IS NULL`, id
    );
    if (!existing) throw new Error('Alert not found or already deleted.');
    const current = this.rowToAlert(existing);
    const title = updates.title ?? current.title;
    const eventDate = updates.eventDate !== undefined ? updates.eventDate : current.eventDate;
    const eventTime = updates.eventTime !== undefined ? updates.eventTime : current.eventTime;
    const reminderTiming = updates.reminderTiming !== undefined ? updates.reminderTiming : current.reminderTiming;
    const priceDirection = updates.priceDirection !== undefined ? updates.priceDirection : current.priceDirection;
    const priceThreshold = updates.priceThreshold !== undefined ? updates.priceThreshold : current.priceThreshold;
    const email = updates.email ?? current.email;
    const status = updates.status ?? current.status;
    await this.db.runAsync(
      `UPDATE stock_alerts SET title = ?, event_date = ?, event_time = ?, reminder_timing = ?,
       price_direction = ?, price_threshold = ?, email = ?, status = ?, updated_at = ? WHERE id = ?`,
      title, eventDate ?? null, eventTime ?? null, reminderTiming ?? null,
      priceDirection ?? null, priceThreshold ?? null, email, status,
      new Date().toISOString(), id
    );
  }

  async deleteStockAlert(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runAsync(
      'UPDATE stock_alerts SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id
    );
  }

  async listAllStockAlerts(): Promise<StockAlert[]> {
    const rows = await this.db.getAllAsync<Parameters<NativeBucketStore['rowToAlert']>[0]>(
      `SELECT id, ticker, type, title, event_date, event_time, reminder_timing,
              price_direction, price_threshold, email, status, created_at, updated_at,
              deleted_at, last_triggered_at, last_triggered_value, last_checked_at
       FROM stock_alerts WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    return rows.map((r) => this.rowToAlert(r));
  }

  // --- Stock tracker ------------------------------------------------------

  private rowToTrackerEntry(r: {
    id: string;
    ticker: string;
    area_price_of_interest: string;
    weekly_macd_trend: string;
    weekly_macd_trend_custom: string | null;
    foreign_flow_sentiment: string;
    event_catalyst: string;
    projection: string;
    notes: string | null;
    price_alert_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }): StockTrackerEntry {
    return {
      id: r.id,
      ticker: r.ticker,
      areaPriceOfInterest: r.area_price_of_interest,
      weeklyMacdTrend: r.weekly_macd_trend as WeeklyMacdTrend,
      weeklyMacdTrendCustom: r.weekly_macd_trend_custom,
      foreignFlowSentiment: r.foreign_flow_sentiment as ForeignFlowSentiment,
      eventCatalyst: r.event_catalyst,
      projection: r.projection,
      notes: r.notes,
      priceAlertId: r.price_alert_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    };
  }

  async listAllStockTrackerEntries(): Promise<StockTrackerEntry[]> {
    const rows = await this.db.getAllAsync<Parameters<NativeBucketStore['rowToTrackerEntry']>[0]>(
      `SELECT id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
              foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
              created_at, updated_at, deleted_at
       FROM stock_tracker WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    return rows.map((r) => this.rowToTrackerEntry(r));
  }

  async getStockTrackerEntry(id: string): Promise<StockTrackerEntry | null> {
    const row = await this.db.getFirstAsync<Parameters<NativeBucketStore['rowToTrackerEntry']>[0]>(
      `SELECT id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
              foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
              created_at, updated_at, deleted_at
       FROM stock_tracker WHERE id = ? AND deleted_at IS NULL`,
      id
    );
    return row ? this.rowToTrackerEntry(row) : null;
  }

  async getStockTrackerForTicker(ticker: string): Promise<StockTrackerEntry | null> {
    const row = await this.db.getFirstAsync<Parameters<NativeBucketStore['rowToTrackerEntry']>[0]>(
      `SELECT id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
              foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
              created_at, updated_at, deleted_at
       FROM stock_tracker WHERE ticker = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
      ticker.trim().toUpperCase()
    );
    return row ? this.rowToTrackerEntry(row) : null;
  }

  async upsertStockTrackerEntry(
    input: Omit<StockTrackerEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
      id?: string;
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<StockTrackerEntry> {
    const now = new Date().toISOString();
    const id = input.id || generateUuid();
    const existing = await this.db.getFirstAsync<{ created_at: string }>(
      'SELECT created_at FROM stock_tracker WHERE id = ?', id
    );

    const ticker = input.ticker.trim().toUpperCase();
    const areaPriceOfInterest = input.areaPriceOfInterest ?? '';
    const weeklyMacdTrend = input.weeklyMacdTrend ?? 'none';
    const weeklyMacdTrendCustom = input.weeklyMacdTrendCustom ?? null;
    const foreignFlowSentiment = input.foreignFlowSentiment ?? 'unknown';
    const eventCatalyst = input.eventCatalyst ?? '';
    const projection = input.projection ?? '';
    const notes = input.notes ?? null;
    const priceAlertId = input.priceAlertId ?? null;
    const createdAt = existing?.created_at ?? input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.db.runAsync(
      `INSERT OR REPLACE INTO stock_tracker
       (id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
        foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
        created_at, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      id, ticker, areaPriceOfInterest, weeklyMacdTrend, weeklyMacdTrendCustom,
      foreignFlowSentiment, eventCatalyst, projection, notes, priceAlertId,
      createdAt, updatedAt
    );

    return {
      id, ticker, areaPriceOfInterest, weeklyMacdTrend, weeklyMacdTrendCustom,
      foreignFlowSentiment, eventCatalyst, projection, notes, priceAlertId,
      createdAt, updatedAt, deletedAt: null,
    };
  }

  async deleteStockTrackerEntry(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runAsync(
      'UPDATE stock_tracker SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id
    );
  }

  async getSyncSnapshot(): Promise<SyncSnapshot> {
    const buckets = await this.db.getAllAsync<{
      uuid: string; name: string; yield_low: number | null; yield_high: number | null; color: string | null;
      sort_order: number; updated_at: string; deleted_at: string | null;
    }>('SELECT uuid, name, yield_low, yield_high, color, sort_order, updated_at, deleted_at FROM buckets');

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

    const stockNotes = await this.db.getAllAsync<{
      id: string; ticker: string; content_html: string; created_at: string; updated_at: string; deleted_at: string | null;
    }>('SELECT id, ticker, content_html, created_at, updated_at, deleted_at FROM stock_notes');

    const stockTags = await this.db.getAllAsync<{
      ticker: string; tag: string; assigned_at: string; updated_at: string; deleted_at: string | null;
    }>('SELECT ticker, tag, assigned_at, updated_at, deleted_at FROM stock_tags');

    const alertRows = await this.db.getAllAsync<Parameters<NativeBucketStore['rowToAlert']>[0]>(
      `SELECT id, ticker, type, title, event_date, event_time, reminder_timing,
              price_direction, price_threshold, email, status, created_at, updated_at,
              deleted_at, last_triggered_at, last_triggered_value, last_checked_at
       FROM stock_alerts`
    );

    const trackerRows = await this.db.getAllAsync<Parameters<NativeBucketStore['rowToTrackerEntry']>[0]>(
      `SELECT id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
              foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
              created_at, updated_at, deleted_at
       FROM stock_tracker`
    );

    const settingsRows = await this.db.getAllAsync<{ key: string; value: number; updated_at: string | null }>(
      'SELECT key, value, updated_at FROM settings'
    );
    const goalRow = settingsRows.find((r) => r.key === 'monthlyIncomeGoal');
    const themeRow = settingsRows.find((r) => r.key === 'themeMode');
    const settingsUpdatedAt = [goalRow?.updated_at, themeRow?.updated_at]
      .filter((v): v is string => !!v).sort().pop() ?? new Date().toISOString();

    return {
      buckets: buckets.map((b) => ({
        uuid: b.uuid, name: b.name, yieldLow: b.yield_low, yieldHigh: b.yield_high, color: b.color,
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
      stockNotes: stockNotes.map((n) => ({
        uuid: n.id, ticker: n.ticker, contentHtml: n.content_html,
        createdAt: n.created_at, updatedAt: n.updated_at, deletedAt: n.deleted_at,
      })),
      stockTags: stockTags.map((r) => ({
        ticker: r.ticker, tag: r.tag, assignedAt: r.assigned_at,
        updatedAt: r.updated_at, deletedAt: r.deleted_at ?? null,
      })),
      stockAlerts: alertRows.map((r) => this.rowToAlert(r)),
      stockTrackerEntries: trackerRows.map((t) => this.rowToTrackerEntry(t)),
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
    if (watchlistItem) return true;
    const note = await this.db.getFirstAsync<{ id: string }>('SELECT id FROM stock_notes WHERE deleted_at IS NULL LIMIT 1');
    if (note) return true;
    const tracker = await this.db.getFirstAsync<{ id: string }>('SELECT id FROM stock_tracker WHERE deleted_at IS NULL LIMIT 1');
    return !!tracker;
  }

  // Phase 3 (sync-plan.md §5/§8): one-way pull, clean overwrite rather than
  // a merge - step 3 of the sync engine (conflict resolution) isn't needed
  // for v1. Wrapped in a single withTransactionAsync so it's atomic: if any
  // insert fails partway through, SQLite rolls back the whole thing,
  // including the DELETEs at the top, leaving local data exactly as it was
  // before the restore was attempted rather than half-overwritten.
  async restoreFromSyncSnapshot(snapshot: SyncSnapshot): Promise<RestoreResult> {
    let bucketsWritten = 0, transactionsWritten = 0, watchlistWritten = 0, stockNotesWritten = 0, stockTagsWritten = 0, stockAlertsWritten = 0, stockTrackerEntriesWritten = 0;

    await this.db.withTransactionAsync(async () => {
      await this.db.execAsync('DELETE FROM transactions; DELETE FROM buckets; DELETE FROM watchlist; DELETE FROM stock_notes; DELETE FROM stock_tags; DELETE FROM stock_alerts; DELETE FROM stock_tracker;');

      // Buckets first, so bucketUuid -> local integer id resolves before
      // transactions (which reference bucket_id, not bucketUuid) are inserted.
      const bucketUuidToId = new Map<string, number>();
      for (const b of snapshot.buckets) {
        if (b.deletedAt) continue; // tombstone - not wired into any UI yet (Phase 0), but skip defensively
        const result = await this.db.runAsync(
          'INSERT INTO buckets (name, yield_low, yield_high, color, sort_order, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          b.name, b.yieldLow, b.yieldHigh, b.color, b.sortOrder, b.uuid, b.updatedAt
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

      for (const n of snapshot.stockNotes) {
        if (n.deletedAt) continue;
        await this.db.runAsync(
          'INSERT INTO stock_notes (id, ticker, content_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          n.uuid, n.ticker, n.contentHtml, n.createdAt, n.updatedAt
        );
        stockNotesWritten++;
      }

      for (const t of snapshot.stockTags ?? []) {
        if (t.deletedAt) continue;
        await this.db.runAsync(
          'INSERT INTO stock_tags (ticker, tag, assigned_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
          t.ticker, t.tag, t.assignedAt, t.updatedAt
        );
        stockTagsWritten++;
      }

      for (const a of snapshot.stockAlerts ?? []) {
        if (a.deletedAt) continue;
        await this.db.runAsync(
          `INSERT INTO stock_alerts
           (id, ticker, type, title, event_date, event_time, reminder_timing,
            price_direction, price_threshold, email, status, created_at, updated_at, deleted_at,
            last_triggered_at, last_triggered_value, last_checked_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
          a.id, a.ticker, a.type, a.title, a.eventDate ?? null, a.eventTime ?? null,
          a.reminderTiming ?? null, a.priceDirection ?? null, a.priceThreshold ?? null,
          a.email, a.status, a.createdAt, a.updatedAt,
          a.lastTriggeredAt ?? null,
          a.lastTriggeredValue != null ? String(a.lastTriggeredValue) : null,
          a.lastCheckedAt ?? null
        );
        stockAlertsWritten++;
      }

      for (const e of snapshot.stockTrackerEntries ?? []) {
        if (e.deletedAt) continue;
        await this.db.runAsync(
          `INSERT INTO stock_tracker
           (id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
            foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
            created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
          e.id, e.ticker, e.areaPriceOfInterest ?? '', e.weeklyMacdTrend ?? 'none',
          e.weeklyMacdTrendCustom ?? null, e.foreignFlowSentiment ?? 'unknown',
          e.eventCatalyst ?? '', e.projection ?? '', e.notes ?? null, e.priceAlertId ?? null,
          e.createdAt, e.updatedAt
        );
        stockTrackerEntriesWritten++;
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

    return { bucketsWritten, transactionsWritten, watchlistWritten, stockNotesWritten, stockTagsWritten, stockAlertsWritten, stockTrackerEntriesWritten, settingsRestored: true };
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
        'UPDATE buckets SET name = ?, yield_low = ?, yield_high = ?, color = ?, sort_order = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
        record.name, record.yieldLow, record.yieldHigh, record.color, record.sortOrder, record.updatedAt, record.deletedAt, existing.id
      );
      return;
    }
    // New to this device. name is UNIQUE - see the "known gap" note on
    // applySyncedBucket in storeApi.ts for the cross-device name-collision
    // case this doesn't attempt to resolve.
    await this.db.runAsync(
      'INSERT INTO buckets (name, yield_low, yield_high, color, sort_order, uuid, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      record.name, record.yieldLow, record.yieldHigh, record.color, record.sortOrder, record.uuid, record.updatedAt, record.deletedAt
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

  async applySyncedStockNote(record: SyncStockNoteRecord): Promise<void> {
    const existing = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM stock_notes WHERE id = ?', record.uuid
    );
    if (existing) {
      await this.db.runAsync(
        'UPDATE stock_notes SET ticker = ?, content_html = ?, created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
        record.ticker, record.contentHtml, record.createdAt, record.updatedAt, record.deletedAt, record.uuid
      );
      return;
    }
    await this.db.runAsync(
      'INSERT INTO stock_notes (id, ticker, content_html, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
      record.uuid, record.ticker, record.contentHtml, record.createdAt, record.updatedAt, record.deletedAt
    );
  }

  async applySyncedTag(record: SyncStockTagRecord): Promise<void> {
    // (ticker, tag) IS the composite PRIMARY KEY on stock_tags, so a single
    // INSERT OR REPLACE handles both the insert-new and update-existing cases
    // without needing a SELECT-then-branch.
    await this.db.runAsync(
      `INSERT INTO stock_tags (ticker, tag, assigned_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ticker, tag) DO UPDATE SET
         assigned_at = COALESCE(excluded.assigned_at, stock_tags.assigned_at),
         updated_at  = excluded.updated_at,
         deleted_at  = excluded.deleted_at`,
      record.ticker, record.tag,
      record.assignedAt ?? new Date().toISOString(),
      record.updatedAt,
      record.deletedAt ?? null
    );
  }

  async applySyncedStockAlert(record: StockAlert): Promise<void> {
    const existing = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM stock_alerts WHERE id = ?', record.id
    );
    if (existing) {
      await this.db.runAsync(
        `UPDATE stock_alerts SET ticker = ?, type = ?, title = ?, event_date = ?, event_time = ?,
         reminder_timing = ?, price_direction = ?, price_threshold = ?, email = ?, status = ?,
         created_at = ?, updated_at = ?, deleted_at = ?,
         last_triggered_at = ?, last_triggered_value = ?, last_checked_at = ? WHERE id = ?`,
        record.ticker, record.type, record.title, record.eventDate ?? null, record.eventTime ?? null,
        record.reminderTiming ?? null, record.priceDirection ?? null, record.priceThreshold ?? null,
        record.email, record.status, record.createdAt, record.updatedAt, record.deletedAt ?? null,
        record.lastTriggeredAt ?? null,
        record.lastTriggeredValue != null ? String(record.lastTriggeredValue) : null,
        record.lastCheckedAt ?? null, record.id
      );
      return;
    }
    await this.db.runAsync(
      `INSERT INTO stock_alerts
       (id, ticker, type, title, event_date, event_time, reminder_timing,
        price_direction, price_threshold, email, status, created_at, updated_at, deleted_at,
        last_triggered_at, last_triggered_value, last_checked_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      record.id, record.ticker, record.type, record.title, record.eventDate ?? null,
      record.eventTime ?? null, record.reminderTiming ?? null, record.priceDirection ?? null,
      record.priceThreshold ?? null, record.email, record.status,
      record.createdAt, record.updatedAt, record.deletedAt ?? null,
      record.lastTriggeredAt ?? null,
      record.lastTriggeredValue != null ? String(record.lastTriggeredValue) : null,
      record.lastCheckedAt ?? null
    );
  }

  async applySyncedStockTrackerEntry(record: StockTrackerEntry): Promise<void> {
    const existing = await this.db.getFirstAsync<{ updated_at: string }>(
      'SELECT updated_at FROM stock_tracker WHERE id = ?', record.id
    );
    if (existing && existing.updated_at >= record.updatedAt) {
      return;
    }
    await this.db.runAsync(
      `INSERT OR REPLACE INTO stock_tracker
       (id, ticker, area_price_of_interest, weekly_macd_trend, weekly_macd_trend_custom,
        foreign_flow_sentiment, event_catalyst, projection, notes, price_alert_id,
        created_at, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      record.id, record.ticker, record.areaPriceOfInterest ?? '', record.weeklyMacdTrend ?? 'none',
      record.weeklyMacdTrendCustom ?? null, record.foreignFlowSentiment ?? 'unknown',
      record.eventCatalyst ?? '', record.projection ?? '', record.notes ?? null, record.priceAlertId ?? null,
      record.createdAt, record.updatedAt, record.deletedAt ?? null
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

  async wipeAllLocalData(): Promise<void> {
    // Unlike restoreFromSyncSnapshot (which leaves the settings table's
    // lastSyncedAt/hasCompletedInitialRestore rows alone on purpose - see
    // that method's comment), this clears `settings` too: account deletion
    // should return the app to a genuinely fresh-install state, not one
    // that still remembers a since-deleted account's sync history.
    await this.db.withTransactionAsync(async () => {
      await this.db.execAsync(
        'DELETE FROM transactions; DELETE FROM buckets; DELETE FROM watchlist; DELETE FROM stock_notes; DELETE FROM stock_tags; DELETE FROM stock_alerts; DELETE FROM stock_tracker; DELETE FROM settings;'
      );
    });
  }
}
