// core/db.web.ts
// IndexedDB implementation of BucketStoreAPI, via the 'idb' wrapper library.
// Metro resolves any import of './db' to THIS file automatically on web.
// IndexedDB has no SQL UNIQUE constraint, so dedup is done explicitly via
// a compound index lookup before each insert - same guarantee as SQLite's
// UNIQUE(bucket_id, row_hash), just implemented by hand.

import { openDB, IDBPDatabase } from 'idb';
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

const DB_NAME = 'bucket_portfolio';
const DB_VERSION = 10;

// Sync-prep fields (sync-plan.md §1, §4 Phase 0). Named to match the SQLite
// column names in db.native.ts (uuid / updated_at / deleted_at) rather than
// the camelCase used elsewhere in this file, so the two stores line up
// field-for-field for whoever writes the sync engine later. deleted_at is
// added to the types now but - same as native - isn't wired into any delete
// path yet; that's Phase 4 work.
interface StoredBucket {
  id: number; name: string; yield_low: number | null; yield_high: number | null;
  // User-chosen swatch - see BucketRow.color's doc comment in storeApi.ts.
  // Optional/undefined on rows written before this field existed, treated
  // identically to explicit null (no custom color) everywhere it's read.
  color?: string | null;
  uuid?: string; updated_at?: string; deleted_at?: string | null;
}
interface StoredWebTxn extends StoredTxn {
  id?: number; bucketId: number; isManual?: number;
  uuid?: string; updated_at?: string; deleted_at?: string | null;
}
interface StoredWatchlistItem {
  ticker: string; buyBelowPrice: number | null; addedAt: string;
  updated_at?: string; deleted_at?: string | null;
}
interface StoredStockNote {
  id: string; ticker: string; contentHtml: string; createdAt: string;
  updated_at: string; deleted_at?: string | null;
}
interface StoredStockTag {
  // Compound key stored as array for IndexedDB keyPath - see the
  // createObjectStore call in upgrade(). idb's TypeScript typing accepts
  // the array literal as the keyPath on put/add, and IDBKeyRange.only([...])
  // for exact-pair lookups.
  ticker: string;
  tag: string;
  assigned_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function openBucketDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
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

      // Migration (version 2 -> 3): plain key-value store for small bits of
      // app state that don't fit the buckets/transactions model - currently
      // just the monthly passive income goal, but a generic 'key' keyPath
      // means any future setting can reuse this without another migration.
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Migration (version 3 -> 4): watchlist store, keyed by ticker so
      // add/remove/set-price are all simple keyPath lookups - no compound
      // index needed since a ticker can only be watchlisted once.
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'ticker' });
      }

      // Migration (version 5 -> 6, sync-plan.md §1, §4 Phase 0): backfill
      // uuid/updated_at onto every pre-existing record, matching what
      // db.native.ts's SQLite migration already does. IndexedDB has no
      // ALTER TABLE - a store's records simply lack these keys until
      // something writes them - so unlike the native "add column, then
      // UPDATE all rows" this has to walk each store's cursor during the
      // versionchange transaction and rewrite any record missing the field.
      // Only buckets/transactions get a uuid (watchlist's stable key is
      // already its ticker; settings is a handful of singleton rows) - see
      // sync-plan.md §1/§2 for why.
      if (oldVersion < 6) {
        const now = new Date().toISOString();
        const backfillStore = (storeName: string, withUuid: boolean) => {
          if (!db.objectStoreNames.contains(storeName)) return;
          const store = transaction.objectStore(storeName);
          store.openCursor().then(function processCursor(cursor): any {
            if (!cursor) return;
            const value = cursor.value;
            if (value.updated_at == null) {
              value.updated_at = now;
              if (withUuid && value.uuid == null) value.uuid = generateUuid();
              cursor.update(value);
            }
            return cursor.continue().then(processCursor);
          });
        };
        backfillStore('buckets', true);
        backfillStore('transactions', true);
        backfillStore('watchlist', false);
        backfillStore('settings', false);
      }

      // Migration (version 6 -> 7): stock notes store, keyed by id (a uuid
      // string - IndexedDB accepts string keys directly, no autoIncrement
      // needed) with a by_ticker index so a ticker's feed is a single
      // indexed lookup rather than a full-store scan.
      if (!db.objectStoreNames.contains('stock_notes')) {
        const notes = db.createObjectStore('stock_notes', { keyPath: 'id' });
        notes.createIndex('by_ticker', 'ticker');
      }

      // Migration (version 7 -> 8): stock tags store. Compound [ticker, tag]
      // keyPath makes an exact-pair lookup a direct get([ticker, tag]) rather
      // than a scan; IndexedDB treats the array literally as the object's key
      // for put/add (same compound-key pattern as by_bucket_hash on
      // transactions, just promoted to keyPath instead of an index). A
      // by_ticker index covers getTagsForTicker's filtered read without
      // a full-store scan; a by_tag index covers getTickersForTag's reverse
      // lookup.
      if (!db.objectStoreNames.contains('stock_tags')) {
        const tags = db.createObjectStore('stock_tags', { keyPath: ['ticker', 'tag'] });
        tags.createIndex('by_ticker', 'ticker');
        tags.createIndex('by_tag', 'tag');
      }

      // Migration (version 8 -> 9): stock alerts store, keyed by id (uuid)
      // with by_ticker and by_updatedAt indexes for filtering and sync updates.
      if (!db.objectStoreNames.contains('stock_alerts')) {
        const alerts = db.createObjectStore('stock_alerts', { keyPath: 'id' });
        alerts.createIndex('by_ticker', 'ticker');
        alerts.createIndex('by_updatedAt', 'updatedAt');
      }

      // Migration (version 9 -> 10): stock tracker store, keyed by id (uuid)
      // with by_ticker index for quick lookup by ticker.
      if (!db.objectStoreNames.contains('stock_tracker')) {
        const tracker = db.createObjectStore('stock_tracker', { keyPath: 'id' });
        tracker.createIndex('by_ticker', 'ticker');
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
    if (existing) {
      // by_name is a unique index, so a soft-deleted bucket (Phase 4,
      // sync-plan.md §10a) permanently occupies its name unless revived
      // here - same reasoning as db.native.ts.
      if (existing.deleted_at) {
        existing.deleted_at = null;
        existing.updated_at = new Date().toISOString();
        await this.db.put('buckets', existing);
      }
      return existing.id;
    }
    const id = await this.db.add('buckets', {
      name, yield_low: yieldLow ?? null, yield_high: yieldHigh ?? null,
      uuid: generateUuid(), updated_at: new Date().toISOString(),
    } as any);
    return id as number;
  }

  async listBuckets(): Promise<BucketRow[]> {
    const all = await this.db.getAll('buckets') as StoredBucket[];
    return all.filter((b) => !b.deleted_at).sort((a, b) => a.name.localeCompare(b.name))
      // Normalize undefined -> null: rows written before `color` existed
      // have no such key at all (IndexedDB is schemaless, no migration
      // step like native's ALTER TABLE) - BucketRow.color is a required
      // `string | null`, not optional, so every row needs an explicit value.
      .map((b) => ({ ...b, color: b.color ?? null }));
  }

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null; color?: string | null }): Promise<void> {
    const current = await this.db.get('buckets', id) as StoredBucket | undefined;
    if (!current || current.deleted_at) throw new Error(`Bucket ${id} not found`);
    const updated: StoredBucket = {
      ...current,
      id,
      name: updates.name ?? current.name,
      yield_low: updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low,
      yield_high: updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high,
      color: updates.color !== undefined ? updates.color : (current.color ?? null),
      updated_at: new Date().toISOString(),
    };
    await this.db.put('buckets', updated);
  }

  async deleteBucket(id: number): Promise<void> {
    // Excludes already-tombstoned transactions - a bucket whose only
    // transactions are soft-deleted has no real holdings left and
    // shouldn't be stuck permanently behind this guard (Phase 4,
    // sync-plan.md §10a).
    const txns = (await this.db.getAllFromIndex('transactions' as any, 'by_bucket', id) as StoredWebTxn[])
      .filter((t) => !t.deleted_at);
    if (txns.length > 0) {
      throw new Error('Cannot delete bucket with existing holdings');
    }
    // Soft delete (Phase 4, sync-plan.md §10a): a tombstone, not a real
    // delete, so the deletion itself can sync instead of being silently
    // un-deleted by a stale pull from another device.
    const bucket = await this.db.get('buckets', id) as StoredBucket | undefined;
    if (!bucket) return;
    const now = new Date().toISOString();
    bucket.deleted_at = now;
    bucket.updated_at = now;
    await this.db.put('buckets', bucket);
  }

  async importIntoBucket(bucketName: string, rows: RawRow[]) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const prepared = prepareRows(rows);

    let inserted = 0, skipped = 0;
    const importedAt = new Date().toISOString();
    const tx = this.db.transaction('transactions', 'readwrite');
    const index = tx.store.index('by_bucket_hash');
    for (const t of prepared) {
      const dupe = await index.get([bucketId, t.rowHash]);
      if (dupe) { skipped++; continue; }
      await tx.store.add({ bucketId, ...t, uuid: generateUuid(), updated_at: importedAt } as any);
      inserted++;
    }
    await tx.done;
    return { inserted, skippedDuplicates: skipped };
  }

  async getBucketHoldings(bucketName: string) {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    const relevant: StoredTxn[] = all.filter(
      (t) => (t.Type === 'BUY' || t.Type === 'SELL') && t.Quantity != null && !t.deleted_at
    );
    return computeHoldings(relevant);
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

  private async getBucketTxns(bucketName: string): Promise<StoredTxn[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    return all.filter(
      (t) => (t.Type === 'BUY' || t.Type === 'SELL' || t.Type === 'CASH DIVIDEND') && !t.deleted_at
    );
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
    const buckets = bucketName ? [{ name: bucketName } as StoredBucket] : await this.listBuckets();
    const perBucket = await Promise.all(
      buckets.map(async (b) => {
        const txns = await this.getBucketTxns(b.name);
        return txns
          .filter((t) => t.Type === 'CASH DIVIDEND' && t.Stock != null)
          .map((t) => ({ date: t.isoDate, ticker: t.Stock!, amount: t.Amount ?? 0, bucket: b.name }));
      })
    );
    return perBucket.flat().sort((a, b) => a.date.localeCompare(b.date));
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
      uuid: generateUuid(),
      updated_at: new Date().toISOString(),
    } as any);
    return id as number;
  }

  async deleteManualTransaction(transactionId: number): Promise<void> {
    const txn = await this.db.get('transactions', transactionId) as StoredWebTxn | undefined;
    if (!txn || txn.deleted_at) throw new Error('Transaction not found');
    if (txn.isManual !== 1) throw new Error('Can only delete manually added transactions');
    // Soft delete (Phase 4, sync-plan.md §10a) - see deleteBucket for why.
    const now = new Date().toISOString();
    txn.deleted_at = now;
    txn.updated_at = now;
    await this.db.put('transactions', txn);
  }

  async updateManualTransaction(
    transactionId: number,
    updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null }
  ): Promise<void> {
    const txn = await this.db.get('transactions', transactionId) as StoredWebTxn | undefined;
    if (!txn || txn.deleted_at) throw new Error('Transaction not found');
    if (txn.isManual !== 1) throw new Error('Can only update manually added transactions');

    if (updates.date !== undefined) {
      txn.Date = updates.date;
      txn.isoDate = updates.date;
    }
    if (updates.quantity !== undefined) txn.Quantity = updates.quantity;
    if (updates.price !== undefined) txn.Price = updates.price;
    if (updates.amount !== undefined) txn.Amount = updates.amount;
    txn.updated_at = new Date().toISOString();

    await this.db.put('transactions', txn);
  }

  async getManualTransactions(bucketName: string): Promise<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    return all
      .filter((t) => t.isManual === 1 && t.Stock != null && !t.deleted_at)
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

  /** Fund BUY rows (imported or manual), pending or settled - see FundFill. */
  async getFundFills(bucketName: string): Promise<FundFill[]> {
    const bucketId = await this.getOrCreateBucket(bucketName);
    const all = await this.db.getAllFromIndex('transactions' as any, 'by_bucket', bucketId) as StoredWebTxn[];
    return all
      .filter((t) => t.Type === 'BUY' && t.Stock != null && t.Amount != null && !!t.Description && /fund/i.test(t.Description) && !t.deleted_at)
      .map((t) => ({
        id: t.id!, date: t.isoDate, stock: t.Stock!, description: t.Description ?? null,
        amount: t.Amount!, quantity: t.Quantity ?? null, price: t.Price ?? null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  }

  async updateFundTransaction(transactionId: number, quantity: number, price: number): Promise<void> {
    const txn = await this.db.get('transactions', transactionId) as StoredWebTxn | undefined;
    if (!txn || txn.deleted_at) throw new Error('Transaction not found');
    if (txn.Type !== 'BUY') throw new Error('Can only set units/price on a BUY transaction');
    txn.Quantity = quantity;
    txn.Price = price;
    txn.updated_at = new Date().toISOString();
    await this.db.put('transactions', txn);
  }

  async getMonthlyIncomeGoal(): Promise<number | null> {
    const row = await this.db.get('settings', 'monthlyIncomeGoal') as { key: string; value: number } | undefined;
    return row?.value ?? null;
  }

  async setMonthlyIncomeGoal(goal: number | null): Promise<void> {
    if (goal == null) {
      await this.db.delete('settings', 'monthlyIncomeGoal');
    } else {
      await this.db.put('settings', { key: 'monthlyIncomeGoal', value: goal, updated_at: new Date().toISOString() });
    }
  }

  // Same (key, value) settings store as above, encoded as a number:
  // 0 = system, 1 = light, 2 = dark - kept numeric so both platform stores
  // share one encoding even though IndexedDB itself could hold a string.
  async getThemeMode(): Promise<'system' | 'light' | 'dark'> {
    const row = await this.db.get('settings', 'themeMode') as { key: string; value: number } | undefined;
    return (['system', 'light', 'dark'] as const)[row?.value ?? 0] ?? 'system';
  }

  async setThemeMode(mode: 'system' | 'light' | 'dark'): Promise<void> {
    const value = { system: 0, light: 1, dark: 2 }[mode];
    await this.db.put('settings', { key: 'themeMode', value, updated_at: new Date().toISOString() });
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    const all = await this.db.getAll('watchlist') as StoredWatchlistItem[];
    return all.filter((w) => !w.deleted_at).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async addToWatchlist(ticker: string): Promise<void> {
    const existing = await this.db.get('watchlist', ticker) as StoredWatchlistItem | undefined;
    const now = new Date().toISOString();
    if (existing) {
      // ticker is the keyPath, so a soft-deleted ticker (Phase 4,
      // sync-plan.md §10a) permanently occupies its row unless revived
      // here - same reasoning as getOrCreateBucket. A live row is left
      // untouched (existing "no-op if already watched" behavior).
      if (existing.deleted_at) {
        existing.deleted_at = null;
        existing.buyBelowPrice = null;
        existing.addedAt = now;
        existing.updated_at = now;
        await this.db.put('watchlist', existing);
      }
      return;
    }
    await this.db.add('watchlist', { ticker, buyBelowPrice: null, addedAt: now, updated_at: now } as StoredWatchlistItem);
  }

  async removeFromWatchlist(ticker: string): Promise<void> {
    // Soft delete (Phase 4, sync-plan.md §10a) - see deleteBucket for why.
    const existing = await this.db.get('watchlist', ticker) as StoredWatchlistItem | undefined;
    if (!existing) return;
    const now = new Date().toISOString();
    existing.deleted_at = now;
    existing.updated_at = now;
    await this.db.put('watchlist', existing);
  }

  async setWatchlistBuyBelowPrice(ticker: string, price: number | null): Promise<void> {
    const existing = await this.db.get('watchlist', ticker) as StoredWatchlistItem | undefined;
    if (!existing || existing.deleted_at) throw new Error(`${ticker} is not on the watchlist`);
    existing.buyBelowPrice = price;
    existing.updated_at = new Date().toISOString();
    await this.db.put('watchlist', existing);
  }

  async importPortfolioIntoWatchlist(stocks: PortfolioStockInput[]): Promise<WatchlistImportResult> {
    const merged = dedupePortfolioStocks(stocks);
    let added = 0, loweredPrice = 0, unchanged = 0;
    const tx = this.db.transaction('watchlist', 'readwrite');
    const store = tx.objectStore('watchlist');
    for (const stock of merged) {
      const existing = await store.get(stock.ticker) as StoredWatchlistItem | undefined;
      if (!existing) {
        const now = new Date().toISOString();
        await store.add({ ticker: stock.ticker, buyBelowPrice: stock.buyBelowPrice, addedAt: now, updated_at: now } as StoredWatchlistItem);
        added++;
        continue;
      }
      if (existing.deleted_at) {
        // Revive (Phase 4, sync-plan.md §10a) - same reasoning as
        // addToWatchlist. Treated as a fresh add, not a price merge, since
        // the ticker wasn't actually live on the watchlist.
        const now = new Date().toISOString();
        existing.deleted_at = null;
        existing.buyBelowPrice = stock.buyBelowPrice;
        existing.addedAt = now;
        existing.updated_at = now;
        await store.put(existing);
        added++;
        continue;
      }
      const nextPrice = mergeBuyBelowPrice(existing.buyBelowPrice, stock.buyBelowPrice);
      if (nextPrice !== existing.buyBelowPrice) {
        existing.buyBelowPrice = nextPrice;
        existing.updated_at = new Date().toISOString();
        await store.put(existing);
        loweredPrice++;
      } else {
        unchanged++;
      }
    }
    await tx.done;
    return { added, loweredPrice, unchanged };
  }

  async getStockNotes(ticker: string): Promise<StockNote[]> {
    const all = await this.db.getAllFromIndex('stock_notes', 'by_ticker', ticker) as StoredStockNote[];
    return all
      .filter((n) => !n.deleted_at)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({ id: n.id, ticker: n.ticker, contentHtml: n.contentHtml, createdAt: n.createdAt, updatedAt: n.updated_at }));
  }

  async listAllStockNotes(ticker?: string): Promise<StockNote[]> {
    let raw: StoredStockNote[];
    if (ticker !== undefined && ticker.length > 0) {
      raw = await this.db.getAllFromIndex('stock_notes', 'by_ticker', ticker) as StoredStockNote[];
    } else {
      raw = await this.db.getAll('stock_notes') as StoredStockNote[];
    }
    return raw
      .filter((n) => !n.deleted_at)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({
        id: n.id,
        ticker: n.ticker,
        contentHtml: n.contentHtml,
        createdAt: n.createdAt,
        updatedAt: n.updated_at,
      }));
  }

  async addStockNote(ticker: string, contentHtml: string): Promise<StockNote> {
    const id = generateUuid();
    const now = new Date().toISOString();
    await this.db.add('stock_notes', { id, ticker, contentHtml, createdAt: now, updated_at: now } as StoredStockNote);
    return { id, ticker, contentHtml, createdAt: now, updatedAt: now };
  }

  async updateStockNote(id: string, contentHtml: string): Promise<void> {
    const existing = await this.db.get('stock_notes', id) as StoredStockNote | undefined;
    if (!existing || existing.deleted_at) throw new Error('This note no longer exists.');
    existing.contentHtml = contentHtml;
    existing.updated_at = new Date().toISOString();
    await this.db.put('stock_notes', existing);
  }

  async deleteStockNote(id: string): Promise<void> {
    // Soft delete (same tombstone convention as buckets/watchlist) - see
    // SyncStockNoteRecord's doc comment.
    const existing = await this.db.get('stock_notes', id) as StoredStockNote | undefined;
    if (!existing) return;
    const now = new Date().toISOString();
    existing.deleted_at = now;
    existing.updated_at = now;
    await this.db.put('stock_notes', existing);
  }

  /** Normalize one tag value before writing - mirrors the native
   *  implementation (trim, collapse whitespace, prepend "#" if missing) so
   *  any non-UI write path (restore, sync apply) produces the same storage
   *  format as the interactive tag editor. */
  private normalizeTagValue(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return '';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }

  async getTagsForTicker(ticker: string): Promise<StockTagAssignment[]> {
    const all = await this.db.getAllFromIndex('stock_tags', 'by_ticker', ticker) as StoredStockTag[];
    return all
      .filter((r) => !r.deleted_at)
      .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at))
      .map((r) => ({
        ticker: r.ticker, tag: r.tag,
        assignedAt: r.assigned_at ?? r.assigned_at ?? null,
        updatedAt: r.updated_at ?? null,
        deletedAt: r.deleted_at ?? null,
      }));
  }

  async setTagsForTicker(ticker: string, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    // Normalize, drop empties, dedupe.
    const seen = new Set<string>();
    const target: string[] = [];
    for (const t of tags) {
      const norm = this.normalizeTagValue(t);
      if (norm.length === 0) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      target.push(norm);
    }

    // Fetch every existing row for this ticker (including tombstoned) so we
    // can diff against it - same logic as the native implementation.
    const existing = await this.db.getAllFromIndex('stock_tags', 'by_ticker', ticker) as StoredStockTag[];
    const existingMap = new Map(existing.map((r) => [r.tag, r]));

    // 1. Each incoming tag: INSERT if new, REVIVE if tombstoned, skip if live.
    for (const tag of target) {
      const ex = existingMap.get(tag);
      if (!ex) {
        await this.db.add('stock_tags', {
          ticker, tag, assigned_at: now, updated_at: now, deleted_at: null,
        } as StoredStockTag);
      } else if (ex.deleted_at != null) {
        // Revive tombstone: keep original assigned_at, only bump updated_at.
        ex.deleted_at = null;
        ex.updated_at = now;
        await this.db.put('stock_tags', ex);
      }
      // else: already live - no write needed (preserves LWW timestamps).
    }

    // 2. Every currently-live tag NOT in the incoming set: soft-delete.
    const keep = new Set(target);
    for (const ex of existing) {
      if (ex.deleted_at != null) continue;
      if (!keep.has(ex.tag)) {
        ex.deleted_at = now;
        ex.updated_at = now;
        await this.db.put('stock_tags', ex);
      }
    }
  }

  async getAllTagsWithCounts(): Promise<{ tag: string; tickerCount: number; mostRecentAssignedAt: string }[]> {
    const all = await this.db.getAll('stock_tags') as StoredStockTag[];
    const live = all.filter((r) => !r.deleted_at);
    // Group by tag: count distinct tickers, track most-recent assigned_at.
    const byTag = new Map<string, { tickers: Set<string>; mostRecent: string }>();
    for (const r of live) {
      let entry = byTag.get(r.tag);
      if (!entry) { entry = { tickers: new Set(), mostRecent: r.assigned_at }; byTag.set(r.tag, entry); }
      entry.tickers.add(r.ticker);
      if (r.assigned_at > entry.mostRecent) entry.mostRecent = r.assigned_at;
    }
    return Array.from(byTag.entries())
      .map(([tag, { tickers, mostRecent }]) => ({ tag, tickerCount: tickers.size, mostRecentAssignedAt: mostRecent }))
      .sort((a, b) => b.tickerCount - a.tickerCount || b.mostRecentAssignedAt.localeCompare(a.mostRecentAssignedAt));
  }

  async getTickersForTag(tag: string): Promise<(StockTagAssignment & { ticker: string })[]> {
    const all = await this.db.getAllFromIndex('stock_tags', 'by_tag', tag) as StoredStockTag[];
    return all
      .filter((r) => !r.deleted_at)
      .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at))
      .map((r) => ({
        ticker: r.ticker, tag: r.tag,
        assignedAt: r.assigned_at ?? null,
        updatedAt: r.updated_at ?? null,
        deletedAt: r.deleted_at ?? null,
      }));
  }

  async getAlertsForTicker(ticker: string): Promise<StockAlert[]> {
    const all = await this.db.getAllFromIndex('stock_alerts', 'by_ticker', ticker) as StockAlert[];
    const live = all.filter((r) => !r.deletedAt);
    live.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return live;
  }

  async addStockAlert(alertInput: Omit<StockAlert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<StockAlert> {
    const now = new Date().toISOString();
    const alert: StockAlert = {
      ...alertInput,
      id: generateUuid(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      lastTriggeredAt: null,
      lastTriggeredValue: null,
      lastCheckedAt: null,
    };
    await this.db.put('stock_alerts', alert);
    return alert;
  }

  async updateStockAlert(
    id: string,
    updates: Partial<Pick<StockAlert, 'title' | 'eventDate' | 'eventTime' | 'reminderTiming' | 'priceDirection' | 'priceThreshold' | 'email' | 'status'>>
  ): Promise<void> {
    const existing = await this.db.get('stock_alerts', id) as StockAlert | undefined;
    if (!existing) throw new Error(`StockAlert not found: ${id}`);
    const now = new Date().toISOString();
    const next: StockAlert = {
      ...existing,
      ...updates,
      updatedAt: now,
    };
    await this.db.put('stock_alerts', next);
  }

  async deleteStockAlert(id: string): Promise<void> {
    const existing = await this.db.get('stock_alerts', id) as StockAlert | undefined;
    if (!existing) return;
    const now = new Date().toISOString();
    const next: StockAlert = {
      ...existing,
      updatedAt: now,
      deletedAt: now,
    };
    await this.db.put('stock_alerts', next);
  }

  async listAllStockAlerts(): Promise<StockAlert[]> {
    const all = await this.db.getAll('stock_alerts') as StockAlert[];
    const live = all.filter((r) => !r.deletedAt);
    live.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return live;
  }

  async listAllStockTrackerEntries(): Promise<StockTrackerEntry[]> {
    const all = await this.db.getAll('stock_tracker') as StockTrackerEntry[];
    const live = all.filter((r) => !r.deletedAt);
    live.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return live;
  }

  async getStockTrackerEntry(id: string): Promise<StockTrackerEntry | null> {
    const entry = await this.db.get('stock_tracker', id) as StockTrackerEntry | undefined;
    if (!entry || entry.deletedAt) return null;
    return entry;
  }

  async getStockTrackerForTicker(ticker: string): Promise<StockTrackerEntry | null> {
    const all = await this.db.getAllFromIndex('stock_tracker', 'by_ticker', ticker) as StockTrackerEntry[];
    const live = all.filter((r) => !r.deletedAt);
    if (live.length === 0) return null;
    live.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return live[0];
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
    const existing = await this.db.get('stock_tracker', id) as StockTrackerEntry | undefined;

    const entry: StockTrackerEntry = {
      id,
      ticker: input.ticker.trim().toUpperCase(),
      areaPriceOfInterest: input.areaPriceOfInterest ?? '',
      weeklyMacdTrend: input.weeklyMacdTrend ?? 'none',
      weeklyMacdTrendCustom: input.weeklyMacdTrendCustom ?? null,
      foreignFlowSentiment: input.foreignFlowSentiment ?? 'unknown',
      eventCatalyst: input.eventCatalyst ?? '',
      eventDate: input.eventDate ?? null,
      eventAlertId: input.eventAlertId ?? null,
      projection: input.projection ?? '',
      notes: input.notes ?? null,
      priceAlertId: input.priceAlertId ?? null,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      deletedAt: null,
    };
    await this.db.put('stock_tracker', entry);
    return entry;
  }

  async deleteStockTrackerEntry(id: string): Promise<void> {
    const existing = await this.db.get('stock_tracker', id) as StockTrackerEntry | undefined;
    if (!existing) return;
    const now = new Date().toISOString();
    const next: StockTrackerEntry = {
      ...existing,
      deletedAt: now,
      updatedAt: now,
    };
    await this.db.put('stock_tracker', next);
  }

  async getSyncSnapshot(): Promise<SyncSnapshot> {
    const buckets = await this.db.getAll('buckets') as StoredBucket[];
    const bucketUuidById = new Map(buckets.map((b) => [b.id, b.uuid]));

    const allTxns = await this.db.getAll('transactions') as StoredWebTxn[];
    const watchlist = await this.db.getAll('watchlist') as StoredWatchlistItem[];
    const stockNotes = await this.db.getAll('stock_notes') as StoredStockNote[];
    const stockTags = await this.db.getAll('stock_tags') as StoredStockTag[];
    const stockAlerts = await this.db.getAll('stock_alerts') as StockAlert[];
    const stockTrackerEntries = await this.db.getAll('stock_tracker') as StockTrackerEntry[];
    const settingsRows = await this.db.getAll('settings') as { key: string; value: number; updated_at?: string }[];
    const goalRow = settingsRows.find((r) => r.key === 'monthlyIncomeGoal');
    const themeRow = settingsRows.find((r) => r.key === 'themeMode');
    const settingsUpdatedAt = [goalRow?.updated_at, themeRow?.updated_at]
      .filter((v): v is string => !!v).sort().pop() ?? new Date().toISOString();

    return {
      // Bucket ordering isn't implemented on either platform yet - native has
      // a sort_order column that's always 0 (schema reserved for a future
      // reorder feature, nothing sets it), web has no such field at all.
      // Hardcoding 0 here matches native's actual current value rather than
      // adding a real column for a feature that doesn't exist yet.
      buckets: buckets.map((b) => ({
        uuid: b.uuid!, name: b.name, yieldLow: b.yield_low, yieldHigh: b.yield_high, color: b.color ?? null,
        sortOrder: 0, updatedAt: b.updated_at!, deletedAt: b.deleted_at ?? null,
      })),
      transactions: allTxns.map((t) => ({
        uuid: t.uuid!, bucketUuid: bucketUuidById.get(t.bucketId)!, date: t.isoDate, type: t.Type,
        stock: t.Stock, description: t.Description, quantity: t.Quantity, price: t.Price,
        fees: t['Comm & Other Fees'] ?? null, currency: t.Currency, amount: t.Amount,
        rowHash: t.rowHash, isManual: t.isManual === 1,
        updatedAt: t.updated_at!, deletedAt: t.deleted_at ?? null,
      })),
      watchlist: watchlist.map((w) => ({
        ticker: w.ticker, buyBelowPrice: w.buyBelowPrice, addedAt: w.addedAt,
        updatedAt: w.updated_at!, deletedAt: w.deleted_at ?? null,
      })),
      stockNotes: stockNotes.map((n) => ({
        uuid: n.id, ticker: n.ticker, contentHtml: n.contentHtml,
        createdAt: n.createdAt, updatedAt: n.updated_at, deletedAt: n.deleted_at ?? null,
      })),
      stockTags: stockTags.map((r) => ({
        ticker: r.ticker, tag: r.tag,
        assignedAt: r.assigned_at ?? null,
        updatedAt: r.updated_at ?? null,
        deletedAt: r.deleted_at ?? null,
      })),
      stockAlerts: stockAlerts.map((a) => ({
        id: a.id, ticker: a.ticker, type: a.type, title: a.title,
        eventDate: a.eventDate ?? null, eventTime: a.eventTime ?? null, reminderTiming: a.reminderTiming ?? null,
        priceDirection: a.priceDirection ?? null, priceThreshold: a.priceThreshold ?? null,
        email: a.email, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt, deletedAt: a.deletedAt ?? null,
        lastTriggeredAt: a.lastTriggeredAt ?? null, lastTriggeredValue: a.lastTriggeredValue ?? null, lastCheckedAt: a.lastCheckedAt ?? null,
      })),
      stockTrackerEntries: stockTrackerEntries.map((e) => ({
        id: e.id, ticker: e.ticker, areaPriceOfInterest: e.areaPriceOfInterest ?? '',
        weeklyMacdTrend: e.weeklyMacdTrend ?? 'none', weeklyMacdTrendCustom: e.weeklyMacdTrendCustom ?? null,
        foreignFlowSentiment: e.foreignFlowSentiment ?? 'unknown', eventCatalyst: e.eventCatalyst ?? '', eventDate: e.eventDate ?? null, eventAlertId: e.eventAlertId ?? null,
        projection: e.projection ?? '', notes: e.notes ?? null, priceAlertId: e.priceAlertId ?? null,
        createdAt: e.createdAt, updatedAt: e.updatedAt, deletedAt: e.deletedAt ?? null,
      })),
      settings: {
        monthlyIncomeGoal: goalRow?.value ?? null,
        themeMode: (['system', 'light', 'dark'] as const)[themeRow?.value ?? 0] ?? 'system',
        updatedAt: settingsUpdatedAt,
      },
    };
  }

  // lastSyncedAt reuses the {key, value} settings store like
  // monthlyIncomeGoal/themeMode above - value is a plain number field there
  // by convention, so the ISO string is stored as epoch milliseconds rather
  // than mixing value types within the same store.
  async getLastSyncedAt(): Promise<string | null> {
    const row = await this.db.get('settings', 'lastSyncedAt') as { key: string; value: number } | undefined;
    return row ? new Date(row.value).toISOString() : null;
  }

  async setLastSyncedAt(iso: string): Promise<void> {
    await this.db.put('settings', { key: 'lastSyncedAt', value: Date.parse(iso), updated_at: iso });
  }

  async hasAnyLocalData(): Promise<boolean> {
    // Excludes tombstones (Phase 4, sync-plan.md §10a) - a device with only
    // soft-deleted rows has nothing live to protect, and should be treated
    // the same as a genuinely empty device by the Phase 3 restore flow.
    // Fetches full records (not just getAllKeys) since deleted_at lives on
    // the record, not the key.
    const buckets = await this.db.getAll('buckets') as StoredBucket[];
    if (buckets.some((b) => !b.deleted_at)) return true;
    const watchlist = await this.db.getAll('watchlist') as StoredWatchlistItem[];
    if (watchlist.some((w) => !w.deleted_at)) return true;
    const notes = await this.db.getAll('stock_notes') as StoredStockNote[];
    if (notes.some((n) => !n.deleted_at)) return true;
    const alerts = await this.db.getAll('stock_alerts') as StockAlert[];
    if (alerts.some((a) => !a.deletedAt)) return true;
    const tracker = await this.db.getAll('stock_tracker') as StockTrackerEntry[];
    return tracker.some((t) => !t.deletedAt);
  }

  // Phase 3 (sync-plan.md §5/§8): one-way pull, clean overwrite rather than
  // a merge. All four stores are opened in ONE readwrite transaction so the
  // whole restore is atomic the same way native's withTransactionAsync is -
  // if any request in here fails, IndexedDB aborts the transaction and
  // rolls back everything, including the .clear() calls, rather than
  // leaving local data half-overwritten.
  async restoreFromSyncSnapshot(snapshot: SyncSnapshot): Promise<RestoreResult> {
    const tx = this.db.transaction(['buckets', 'transactions', 'watchlist', 'stock_notes', 'stock_tags', 'stock_alerts', 'stock_tracker', 'settings'], 'readwrite');
    const bucketsStore = tx.objectStore('buckets');
    const txnsStore = tx.objectStore('transactions');
    const watchlistStore = tx.objectStore('watchlist');
    const notesStore = tx.objectStore('stock_notes');
    const tagsStore = tx.objectStore('stock_tags');
    const alertsStore = tx.objectStore('stock_alerts');
    const trackerStore = tx.objectStore('stock_tracker');
    const settingsStore = tx.objectStore('settings');

    await bucketsStore.clear();
    await txnsStore.clear();
    await watchlistStore.clear();
    await notesStore.clear();
    await tagsStore.clear();
    await alertsStore.clear();
    await trackerStore.clear();

    // Buckets first, so bucketUuid -> local id resolves before transactions
    // (which reference bucketId, not bucketUuid) are inserted.
    const bucketUuidToId = new Map<string, number>();
    let bucketsWritten = 0;
    for (const b of snapshot.buckets) {
      if (b.deletedAt) continue; // tombstone - not wired into any UI yet (Phase 0), but skip defensively
      const id = (await bucketsStore.add({
        name: b.name, yield_low: b.yieldLow, yield_high: b.yieldHigh, color: b.color,
        uuid: b.uuid, updated_at: b.updatedAt,
      } as any)) as number;
      bucketUuidToId.set(b.uuid, id);
      bucketsWritten++;
    }

    let transactionsWritten = 0;
    for (const t of snapshot.transactions) {
      if (t.deletedAt) continue;
      const bucketId = bucketUuidToId.get(t.bucketUuid);
      if (bucketId == null) continue; // orphaned - referenced bucket wasn't in this snapshot, skip rather than throw
      await txnsStore.add({
        bucketId,
        Type: t.type, Stock: t.stock, Date: t.date, isoDate: t.date ?? '',
        Quantity: t.quantity, Price: t.price, Amount: t.amount,
        Description: t.description, Currency: t.currency,
        'Comm & Other Fees': t.fees,
        rowHash: t.rowHash, isManual: t.isManual ? 1 : 0,
        uuid: t.uuid, updated_at: t.updatedAt,
      } as any);
      transactionsWritten++;
    }

    let watchlistWritten = 0;
    for (const w of snapshot.watchlist) {
      if (w.deletedAt) continue;
      await watchlistStore.add({
        ticker: w.ticker, buyBelowPrice: w.buyBelowPrice, addedAt: w.addedAt, updated_at: w.updatedAt,
      } as StoredWatchlistItem);
      watchlistWritten++;
    }

    let stockNotesWritten = 0;
    for (const n of snapshot.stockNotes) {
      if (n.deletedAt) continue;
      await notesStore.add({
        id: n.uuid, ticker: n.ticker, contentHtml: n.contentHtml, createdAt: n.createdAt, updated_at: n.updatedAt,
      } as StoredStockNote);
      stockNotesWritten++;
    }

    let stockTagsWritten = 0;
    for (const t of snapshot.stockTags ?? []) {
      if (t.deletedAt) continue;
      await tagsStore.add({
        ticker: t.ticker, tag: t.tag,
        assigned_at: t.assignedAt, updated_at: t.updatedAt, deleted_at: null,
      } as StoredStockTag);
      stockTagsWritten++;
    }

    let stockAlertsWritten = 0;
    for (const a of snapshot.stockAlerts ?? []) {
      if (a.deletedAt) continue;
      await alertsStore.add({
        id: a.id, ticker: a.ticker, type: a.type, title: a.title,
        eventDate: a.eventDate ?? null, eventTime: a.eventTime ?? null, reminderTiming: a.reminderTiming ?? null,
        priceDirection: a.priceDirection ?? null, priceThreshold: a.priceThreshold ?? null,
        email: a.email, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt, deletedAt: null,
        lastTriggeredAt: a.lastTriggeredAt ?? null, lastTriggeredValue: a.lastTriggeredValue ?? null, lastCheckedAt: a.lastCheckedAt ?? null,
      } as StockAlert);
      stockAlertsWritten++;
    }

    // Only the two settings keys that are actually part of a synced
    // snapshot - lastSyncedAt and hasCompletedInitialRestore live in this
    // same store but describe THIS device's own sync history, not synced
    // data, so a restore must never touch them.
    let stockTrackerEntriesWritten = 0;
    for (const e of snapshot.stockTrackerEntries ?? []) {
      if (e.deletedAt) continue;
      await trackerStore.add({
        id: e.id, ticker: e.ticker, areaPriceOfInterest: e.areaPriceOfInterest ?? '',
        weeklyMacdTrend: e.weeklyMacdTrend ?? 'none', weeklyMacdTrendCustom: e.weeklyMacdTrendCustom ?? null,
        foreignFlowSentiment: e.foreignFlowSentiment ?? 'unknown', eventCatalyst: e.eventCatalyst ?? '', eventDate: e.eventDate ?? null, eventAlertId: e.eventAlertId ?? null,
        projection: e.projection ?? '', notes: e.notes ?? null, priceAlertId: e.priceAlertId ?? null,
        createdAt: e.createdAt, updatedAt: e.updatedAt, deletedAt: null,
      } as StockTrackerEntry);
      stockTrackerEntriesWritten++;
    }

    if (snapshot.settings.monthlyIncomeGoal == null) {
      await settingsStore.delete('monthlyIncomeGoal');
    } else {
      await settingsStore.put({
        key: 'monthlyIncomeGoal', value: snapshot.settings.monthlyIncomeGoal, updated_at: snapshot.settings.updatedAt,
      });
    }
    const themeValue = { system: 0, light: 1, dark: 2 }[snapshot.settings.themeMode];
    await settingsStore.put({ key: 'themeMode', value: themeValue, updated_at: snapshot.settings.updatedAt });

    await tx.done;

    return { bucketsWritten, transactionsWritten, watchlistWritten, stockNotesWritten, stockTagsWritten, stockAlertsWritten, stockTrackerEntriesWritten, settingsRestored: true };
  }

  async getHasCompletedInitialRestore(): Promise<boolean> {
    const row = await this.db.get('settings', 'hasCompletedInitialRestore') as { key: string; value: number } | undefined;
    return row?.value === 1;
  }

  async setHasCompletedInitialRestore(value: boolean): Promise<void> {
    await this.db.put('settings', { key: 'hasCompletedInitialRestore', value: value ? 1 : 0, updated_at: new Date().toISOString() });
  }

  // --- Phase 4 (sync-plan.md §10b): per-record upsert -----------------
  // See storeApi.ts's BucketStoreAPI doc comment for the contract. uuid
  // isn't the IndexedDB keyPath for buckets/transactions (the auto-
  // incrementing local id still is - sync-plan.md §1), so "insert or update
  // by uuid" needs a scan rather than a direct get(). A dedicated `by_uuid`
  // index would make this O(1) instead of O(n), but at personal-portfolio
  // data volumes (same assumption Phase 2's "no dirty-tracking" call
  // already made) a linear scan over getAll() is simple and cheap enough -
  // not worth another DB_VERSION migration for.

  async applySyncedBucket(record: SyncBucketRecord): Promise<void> {
    const all = await this.db.getAll('buckets') as StoredBucket[];
    const existing = all.find((b) => b.uuid === record.uuid);
    if (existing) {
      existing.name = record.name;
      existing.yield_low = record.yieldLow;
      existing.yield_high = record.yieldHigh;
      existing.color = record.color;
      existing.updated_at = record.updatedAt;
      existing.deleted_at = record.deletedAt;
      await this.db.put('buckets', existing);
      return;
    }
    // New to this device. by_name is a UNIQUE index - see the "known gap"
    // note on applySyncedBucket in storeApi.ts for the cross-device
    // name-collision case this doesn't attempt to resolve (db.add throws
    // ConstraintError, same as native's UNIQUE violation).
    // sortOrder is intentionally dropped - web has no such column (see
    // getSyncSnapshot's comment on why bucket ordering isn't implemented
    // on either platform yet).
    await this.db.add('buckets', {
      name: record.name, yield_low: record.yieldLow, yield_high: record.yieldHigh, color: record.color,
      uuid: record.uuid, updated_at: record.updatedAt, deleted_at: record.deletedAt,
    } as any);
  }

  async applySyncedTransaction(record: SyncTransactionRecord): Promise<void> {
    const buckets = await this.db.getAll('buckets') as StoredBucket[];
    const bucket = buckets.find((b) => b.uuid === record.bucketUuid);
    if (!bucket) return; // orphaned - see storeApi.ts doc comment

    const allTxns = await this.db.getAll('transactions') as StoredWebTxn[];
    const existing = allTxns.find((t) => t.uuid === record.uuid);
    const shaped = {
      bucketId: bucket.id,
      Type: record.type, Stock: record.stock, Date: record.date, isoDate: record.date ?? '',
      Quantity: record.quantity, Price: record.price, Amount: record.amount,
      Description: record.description, Currency: record.currency,
      'Comm & Other Fees': record.fees,
      rowHash: record.rowHash, isManual: record.isManual ? 1 : 0,
      uuid: record.uuid, updated_at: record.updatedAt, deleted_at: record.deletedAt,
    };
    if (existing) {
      await this.db.put('transactions', { ...shaped, id: existing.id } as any);
    } else {
      // by_bucket_hash is a UNIQUE [bucketId, rowHash] index - same
      // collision caveat as applySyncedBucket, extremely unlikely given
      // manual transactions' random rowHash and imported ones' content-hash.
      await this.db.add('transactions', shaped as any);
    }
  }

  async applySyncedWatchlistItem(record: SyncWatchlistRecord): Promise<void> {
    // ticker IS the keyPath here (unlike buckets/transactions' uuid), so
    // put() is a genuine insert-or-replace with no scan needed.
    await this.db.put('watchlist', {
      ticker: record.ticker, buyBelowPrice: record.buyBelowPrice, addedAt: record.addedAt,
      updated_at: record.updatedAt, deleted_at: record.deletedAt,
    } as StoredWatchlistItem);
  }

  async applySyncedStockNote(record: SyncStockNoteRecord): Promise<void> {
    // id IS the keyPath here (unlike buckets/transactions' scan-by-uuid), so
    // put() is a genuine insert-or-replace with no lookup needed.
    await this.db.put('stock_notes', {
      id: record.uuid, ticker: record.ticker, contentHtml: record.contentHtml,
      createdAt: record.createdAt, updated_at: record.updatedAt, deleted_at: record.deletedAt,
    } as StoredStockNote);
  }

  async applySyncedTag(record: SyncStockTagRecord): Promise<void> {
    // [ticker, tag] IS the compound keyPath, so put() is a genuine
    // insert-or-replace with no scan needed (same pattern as
    // applySyncedWatchlistItem's ticker keyPath, but compound here).
    const now = new Date().toISOString();
    await this.db.put('stock_tags', {
      ticker: record.ticker,
      tag: record.tag,
      assigned_at: record.assignedAt ?? now,
      updated_at: record.updatedAt,
      deleted_at: record.deletedAt ?? null,
    } as StoredStockTag);
  }

  async applySyncedStockAlert(record: StockAlert): Promise<void> {
    const existing = await this.db.get('stock_alerts', record.id) as StockAlert | undefined;
    if (existing && existing.updatedAt && existing.updatedAt >= record.updatedAt) {
      return;
    }
    await this.db.put('stock_alerts', {
      id: record.id,
      ticker: record.ticker,
      type: record.type,
      title: record.title,
      eventDate: record.eventDate ?? null,
      eventTime: record.eventTime ?? null,
      reminderTiming: record.reminderTiming ?? null,
      priceDirection: record.priceDirection ?? null,
      priceThreshold: record.priceThreshold ?? null,
      email: record.email,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt ?? null,
      lastTriggeredAt: record.lastTriggeredAt ?? null,
      lastTriggeredValue: record.lastTriggeredValue ?? null,
      lastCheckedAt: record.lastCheckedAt ?? null,
    } as StockAlert);
  }

  async applySyncedStockTrackerEntry(record: StockTrackerEntry): Promise<void> {
    const existing = await this.db.get('stock_tracker', record.id) as StockTrackerEntry | undefined;
    if (existing && existing.updatedAt && existing.updatedAt >= record.updatedAt) {
      return;
    }
    await this.db.put('stock_tracker', {
      id: record.id,
      ticker: record.ticker,
      areaPriceOfInterest: record.areaPriceOfInterest ?? '',
      weeklyMacdTrend: record.weeklyMacdTrend ?? 'none',
      weeklyMacdTrendCustom: record.weeklyMacdTrendCustom ?? null,
      foreignFlowSentiment: record.foreignFlowSentiment ?? 'unknown',
      eventCatalyst: record.eventCatalyst ?? '',
      eventDate: record.eventDate ?? null,
      eventAlertId: record.eventAlertId ?? null,
      projection: record.projection ?? '',
      notes: record.notes ?? null,
      priceAlertId: record.priceAlertId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt ?? null,
    } as StockTrackerEntry);
  }

  async applySyncedSettings(record: SyncSettingsRecord): Promise<void> {
    // Same (key, value) settings store + null-means-delete convention as
    // setMonthlyIncomeGoal above.
    if (record.monthlyIncomeGoal == null) {
      await this.db.delete('settings', 'monthlyIncomeGoal');
    } else {
      await this.db.put('settings', { key: 'monthlyIncomeGoal', value: record.monthlyIncomeGoal, updated_at: record.updatedAt });
    }
    const themeValue = { system: 0, light: 1, dark: 2 }[record.themeMode];
    await this.db.put('settings', { key: 'themeMode', value: themeValue, updated_at: record.updatedAt });
  }

  async wipeAllLocalData(): Promise<void> {
    const tx = this.db.transaction(['buckets', 'transactions', 'watchlist', 'stock_notes', 'stock_tags', 'stock_alerts', 'stock_tracker', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('buckets').clear(),
      tx.objectStore('transactions').clear(),
      tx.objectStore('watchlist').clear(),
      tx.objectStore('stock_notes').clear(),
      tx.objectStore('stock_tags').clear(),
      tx.objectStore('stock_alerts').clear(),
      tx.objectStore('stock_tracker').clear(),
      tx.objectStore('settings').clear(),
      tx.done,
    ]);
  }
}
