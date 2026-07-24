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
  SyncBucketRecord, SyncTransactionRecord, SyncWatchlistRecord, SyncSettingsRecord,
} from './storeApi';
import { PortfolioStockInput, dedupePortfolioStocks, mergeBuyBelowPrice } from './watchlistImport';
import { generateUuid } from './uuid';

const DB_NAME = 'bucket_portfolio';
const DB_VERSION = 6;

// Sync-prep fields (sync-plan.md §1, §4 Phase 0). Named to match the SQLite
// column names in db.native.ts (uuid / updated_at / deleted_at) rather than
// the camelCase used elsewhere in this file, so the two stores line up
// field-for-field for whoever writes the sync engine later. deleted_at is
// added to the types now but - same as native - isn't wired into any delete
// path yet; that's Phase 4 work.
interface StoredBucket {
  id: number; name: string; yield_low: number | null; yield_high: number | null;
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
    return all.filter((b) => !b.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null }): Promise<void> {
    const current = await this.db.get('buckets', id) as StoredBucket | undefined;
    if (!current || current.deleted_at) throw new Error(`Bucket ${id} not found`);
    const updated: StoredBucket = {
      ...current,
      id,
      name: updates.name ?? current.name,
      yield_low: updates.yieldLow !== undefined ? updates.yieldLow : current.yield_low,
      yield_high: updates.yieldHigh !== undefined ? updates.yieldHigh : current.yield_high,
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

  async getSyncSnapshot(): Promise<SyncSnapshot> {
    const buckets = await this.db.getAll('buckets') as StoredBucket[];
    const bucketUuidById = new Map(buckets.map((b) => [b.id, b.uuid]));

    const allTxns = await this.db.getAll('transactions') as StoredWebTxn[];
    const watchlist = await this.db.getAll('watchlist') as StoredWatchlistItem[];
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
        uuid: b.uuid!, name: b.name, yieldLow: b.yield_low, yieldHigh: b.yield_high,
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
    return watchlist.some((w) => !w.deleted_at);
  }

  // Phase 3 (sync-plan.md §5/§8): one-way pull, clean overwrite rather than
  // a merge. All four stores are opened in ONE readwrite transaction so the
  // whole restore is atomic the same way native's withTransactionAsync is -
  // if any request in here fails, IndexedDB aborts the transaction and
  // rolls back everything, including the .clear() calls, rather than
  // leaving local data half-overwritten.
  async restoreFromSyncSnapshot(snapshot: SyncSnapshot): Promise<RestoreResult> {
    const tx = this.db.transaction(['buckets', 'transactions', 'watchlist', 'settings'], 'readwrite');
    const bucketsStore = tx.objectStore('buckets');
    const txnsStore = tx.objectStore('transactions');
    const watchlistStore = tx.objectStore('watchlist');
    const settingsStore = tx.objectStore('settings');

    await bucketsStore.clear();
    await txnsStore.clear();
    await watchlistStore.clear();

    // Buckets first, so bucketUuid -> local id resolves before transactions
    // (which reference bucketId, not bucketUuid) are inserted.
    const bucketUuidToId = new Map<string, number>();
    let bucketsWritten = 0;
    for (const b of snapshot.buckets) {
      if (b.deletedAt) continue; // tombstone - not wired into any UI yet (Phase 0), but skip defensively
      const id = (await bucketsStore.add({
        name: b.name, yield_low: b.yieldLow, yield_high: b.yieldHigh,
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

    // Only the two settings keys that are actually part of a synced
    // snapshot - lastSyncedAt and hasCompletedInitialRestore live in this
    // same store but describe THIS device's own sync history, not synced
    // data, so a restore must never touch them.
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

    return { bucketsWritten, transactionsWritten, watchlistWritten, settingsRestored: true };
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
      name: record.name, yield_low: record.yieldLow, yield_high: record.yieldHigh,
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
}
