// core/storeApi.ts
// The one contract both platform implementations (db.native.ts, db.web.ts)
// must satisfy. Screens depend on THIS interface only, via useStore() -
// they never import expo-sqlite or idb directly, so the platform split is
// invisible above this layer.

import { RawRow, StoredTxn, Holding, AggregatedStock, BucketStockPosition, PortfolioSummary, RealizedTrade, FundFill } from './bucketLogic';
import { PortfolioStockInput } from './watchlistImport';

export interface BucketRow {
  id: number;
  name: string;
  yield_low: number | null;
  yield_high: number | null;
}

export interface WatchlistItem {
  ticker: string;
  /** The price the user wants to buy under. null means "watching, no target set yet". */
  buyBelowPrice: number | null;
  /** ISO timestamp of when the ticker was added - powers newest-first ordering. */
  addedAt: string;
}

export interface BucketStoreAPI {
  listBuckets(): Promise<BucketRow[]>;
  getOrCreateBucket(name: string, yieldLow?: number, yieldHigh?: number): Promise<number>;
  /** Rename a bucket and/or adjust its yield bracket. Only fields present
   *  in `updates` are changed - omit a field to leave it as-is. */
  updateBucket(id: number, updates: { name?: string; yieldLow?: number | null; yieldHigh?: number | null }): Promise<void>;
  /** Delete a bucket by ID. Only works if the bucket is empty (no holdings). */
  deleteBucket(id: number): Promise<void>;
  importIntoBucket(
    bucketName: string,
    rows: RawRow[]
  ): Promise<{ inserted: number; skippedDuplicates: number }>;
  getBucketHoldings(
    bucketName: string
  ): Promise<{ holdings: Holding[]; orphanSells: StoredTxn[] }>;
  getAllHoldings(): Promise<(Holding & { bucket: string })[]>;

  /** Main aggregated dashboard: portfolio-wide totals. */
  getPortfolioSummary(): Promise<PortfolioSummary>;
  /** Main aggregated dashboard: one row per ticker, merged across every bucket that holds it. */
  getAggregatedStocks(): Promise<AggregatedStock[]>;
  /** Per-bucket view: holdings + dividends earned, scoped to one bucket. */
  getBucketPositions(bucketName: string): Promise<BucketStockPosition[]>;
  /** Single ticker within a single bucket: the current position if still
   *  held there, otherwise the fully-exited (zero-share) position with its
   *  historical dividends/realized gain intact. Used by the ticker+bucket
   *  drill-down (StockInBucketScreen) so navigating to a bucket you've
   *  since sold out of shows its history instead of a dead end. Returns
   *  null only if the ticker has no history at all in this bucket. */
  getBucketPositionForTicker(bucketName: string, ticker: string): Promise<BucketStockPosition | null>;
  /** Stock detail drill-down: one ticker, merged across every bucket that has
   *  EVER transacted it - including buckets where it's since been fully sold
   *  (returned as zero-share entries). Unlike getAggregatedStocks, a ticker
   *  that's fully exited everywhere still resolves here instead of vanishing.
   *  Powers the "Held In" list. Returns null if the ticker has no history at all. */
  getStockHistory(ticker: string): Promise<AggregatedStock | null>;
  /** Specific stock + bucket drill-down: individual dividend payments. */
  getDividendHistory(bucketName: string, ticker: string): Promise<{ date: string; amount: number }[]>;
  /** Specific stock + bucket drill-down: buy/sell transaction history. */
  getTransactionHistory(bucketName: string, ticker: string): Promise<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }[]>;
  /** Add a manual transaction (BUY, SELL, or CASH DIVIDEND). Returns the transaction ID. */
  addManualTransaction(
    bucketName: string,
    type: 'BUY' | 'SELL' | 'CASH DIVIDEND',
    stock: string,
    date: string,
    quantity?: number,
    price?: number,
    amount?: number
  ): Promise<number>;
  /** Delete a manually added transaction by ID. Only works for transactions added manually. */
  deleteManualTransaction(transactionId: number): Promise<void>;
  /** Update a manually added transaction (date, quantity, price, amount only). Only works for transactions added manually. */
  updateManualTransaction(
    transactionId: number,
    updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null }
  ): Promise<void>;
  /** Get all manually added transactions for a bucket. */
  getManualTransactions(bucketName: string): Promise<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }[]>;
  /** Every fund BUY transaction in a bucket (imported or manual),
   *  classified by a "fund" match in its Description - both still-pending
   *  ones (no Quantity/Price yet) and already-settled ones, newest first.
   *  Powers the "Fund Prices Needed" list on the Import screen, which lets
   *  the user fill in - or go back and correct - units/NAVPU for any fund
   *  buy, not just unsettled ones. */
  getFundFills(bucketName: string): Promise<FundFill[]>;
  /** Sets (or overwrites) the Quantity/Price on a fund BUY row (see
   *  getFundFills). Unlike updateManualTransaction, this works on imported
   *  rows too - settlement data legitimately arrives after the fact, and
   *  a previously-entered value may need correcting. The existing Amount
   *  is left untouched since it's the authoritative peso figure from the
   *  statement. */
  updateFundTransaction(transactionId: number, quantity: number, price: number): Promise<void>;
  /** Every CASH DIVIDEND transaction, either portfolio-wide (bucketName
   *  omitted, aggregated across every bucket) or scoped to one bucket -
   *  powers the Monthly Dividend Income chart/screen on the Dashboard
   *  (aggregated) and BucketDetail (single-bucket) views. Oldest first. */
  getDividendFeed(bucketName?: string): Promise<{ date: string; ticker: string; amount: number; bucket: string }[]>;
  /** All-time dividends + realized gains for a bucket, including tickers that
   *  are now fully exited (and so no longer appear in getBucketPositions or
   *  in a naive sum of getBucketPositions()[].totalDividends). */
  getBucketLifetimeTotals(bucketName: string): Promise<{ totalRealizedGain: number; totalDividends: number; trades: RealizedTrade[] }>;
  /** Every BUY/SELL/CASH DIVIDEND transaction in a bucket, across all tickers
   *  (manual + imported), newest first - powers the bucket-level Transaction
   *  History view. */
  getBucketTransactionFeed(bucketName: string): Promise<{ date: string; type: string; ticker: string; quantity: number | null; price: number | null; amount: number | null }[]>;

  /** The user-set monthly passive income goal (a peso amount), powering the
   *  "Passive Income Goal" gauge on the main Dashboard. null if never set. */
  getMonthlyIncomeGoal(): Promise<number | null>;
  /** Set (or clear, by passing null) the monthly passive income goal. */
  setMonthlyIncomeGoal(goal: number | null): Promise<void>;

  /** The user's saved appearance preference for the Settings > Appearance
   *  toggle. 'system' (the default) follows the OS light/dark setting. */
  getThemeMode(): Promise<'system' | 'light' | 'dark'>;
  setThemeMode(mode: 'system' | 'light' | 'dark'): Promise<void>;

  /** Every ticker the user is watching (not necessarily held), newest-added
   *  first. Powers the Watch List tab. */
  getWatchlist(): Promise<WatchlistItem[]>;
  /** Add a ticker to the watchlist with no buy-below price set yet.
   *  No-op if the ticker is already on the list. */
  addToWatchlist(ticker: string): Promise<void>;
  /** Remove a ticker from the watchlist entirely. */
  removeFromWatchlist(ticker: string): Promise<void>;
  /** Set (or clear, by passing null) the buy-below price for a watchlisted
   *  ticker. Once set, the ticker surfaces under "Within Buy Range" any time
   *  its current price is at or below this value. Throws if the ticker
   *  isn't on the watchlist yet - add it first. */
  setWatchlistBuyBelowPrice(ticker: string, price: number | null): Promise<void>;
  /** Copies a batch of ticker + buy-below-price rows (one or more shared
   *  "portfolios" from core/portfolioCatalog.ts, already merged together by
   *  the caller if more than one was selected) into the watchlist. A
   *  ticker not yet watched is added with the incoming price; a ticker
   *  already on the watchlist keeps the LOWER of its existing price and the
   *  incoming one (see core/watchlistImport.ts) rather than being
   *  overwritten - so importing never loosens a target that's already set. */
  importPortfolioIntoWatchlist(stocks: PortfolioStockInput[]): Promise<WatchlistImportResult>;

  /** Full local dataset shaped for core/syncEngine.ts to push to Firestore -
   *  see sync-plan.md. Includes soft-deleted rows. */
  getSyncSnapshot(): Promise<SyncSnapshot>;
  /** When the last successful push to Firestore completed (ISO timestamp),
   *  for the "Last backed up: …" line on AccountScreen. null if never synced. */
  getLastSyncedAt(): Promise<string | null>;
  /** Records a successful push - called after pushSnapshotToFirestore()
   *  resolves, not before, so a failed/interrupted push doesn't falsely
   *  claim to be backed up. */
  setLastSyncedAt(iso: string): Promise<void>;

  /** True if this device has any bucket or watchlist entry already - used
   *  by the Phase 3 restore flow (sync-plan.md §5/§8) to decide whether a
   *  cloud restore can run silently (nothing local to lose) or needs to
   *  confirm with the user first (would overwrite local-only data). */
  hasAnyLocalData(): Promise<boolean>;
  /** One-way pull applied locally: a clean overwrite (not a merge - see
   *  sync-plan.md §5) of buckets/transactions/watchlist/settings with what
   *  came from Firestore. Rows with deletedAt set are skipped rather than
   *  restored. Atomic - if any part fails, nothing local changes. Does NOT
   *  touch getLastSyncedAt/getHasCompletedInitialRestore bookkeeping, since
   *  those describe this device's own sync history, not synced data. */
  restoreFromSyncSnapshot(snapshot: SyncSnapshot): Promise<RestoreResult>;
  /** Whether this device has already gone through the first-sign-in restore
   *  check (sync-plan.md §5: "gated to first-login-on-a-device rather than
   *  a repeatable button"). Sticky per-device once set true - a signed-in
   *  session persisting across app launches shouldn't re-prompt every time. */
  getHasCompletedInitialRestore(): Promise<boolean>;
  setHasCompletedInitialRestore(value: boolean): Promise<void>;

  // --- Phase 4 (sync-plan.md §10b): per-record upsert -----------------
  // Narrower than restoreFromSyncSnapshot's wipe-and-reinsert - these apply
  // ONE incoming record each, insert-or-update keyed by uuid (buckets/
  // transactions) or ticker (watchlist), safe to call repeatedly as part of
  // a bidirectional sync without clobbering local edits made since the last
  // sync. The caller (core/syncEngine.ts's applyMergePlan) has already
  // decided, per-record, that the incoming version wins (via mergeSnapshots'
  // last-write-wins compare) - these methods just apply that decision, they
  // don't re-compare updatedAt themselves. Same bucket-before-transaction
  // ordering requirement as restoreFromSyncSnapshot (bucketUuid -> local id
  // must resolve before an incoming transaction referencing it is applied).
  //
  // Known gap, deliberately not handled here (see sync-plan.md §10b): a
  // genuine cross-device name collision (two devices independently creating
  // a same-named bucket, or - structurally impossible for watchlist since
  // ticker IS the key - two independent tickers) can hit the underlying
  // UNIQUE constraint on insert. Full CRDT-style rename-on-conflict was
  // explicitly out of scope for this app's usage pattern (sync-plan.md §2);
  // callers should expect applySyncedBucket to throw in that rare case
  // rather than silently resolve it.
  /** Insert or update a bucket by its uuid (not local id - a bucket new to
   *  this device has no local id yet). */
  applySyncedBucket(record: SyncBucketRecord): Promise<void>;
  /** Insert or update a transaction by its uuid. No-ops (skips) if
   *  `record.bucketUuid` doesn't resolve to a local bucket - defensive,
   *  same as restoreFromSyncSnapshot's orphan handling; shouldn't happen
   *  given the ordering guarantee above, but a merge apply is the wrong
   *  place to let a bad record throw instead of degrade. */
  applySyncedTransaction(record: SyncTransactionRecord): Promise<void>;
  /** Insert or update a watchlist entry by its ticker (the natural key -
   *  see sync-plan.md §1, no collision case exists here). */
  applySyncedWatchlistItem(record: SyncWatchlistRecord): Promise<void>;
  /** Overwrite local settings (monthlyIncomeGoal + themeMode) with the
   *  winning side's record - settings is a single record, not a uuid-keyed
   *  collection, so unlike the three methods above there's no per-key
   *  union; the caller decides push-vs-pull for the whole record. */
  applySyncedSettings(record: SyncSettingsRecord): Promise<void>;
}

/** Result of applying a pulled snapshot locally - see restoreFromSyncSnapshot. */
export interface RestoreResult {
  bucketsWritten: number;
  transactionsWritten: number;
  watchlistWritten: number;
  settingsRestored: boolean;
}

export interface WatchlistImportResult {
  /** Tickers that weren't on the watchlist yet and were added. */
  added: number;
  /** Tickers already watched whose buy-below price was lowered by this import. */
  loweredPrice: number;
  /** Tickers already watched whose buy-below price was left as-is (already
   *  equal to or lower than the incoming price, or the incoming row had no
   *  price to offer). */
  unchanged: number;
}

// --- Sync (see sync-plan.md) ---------------------------------------------
// Shapes read by core/syncEngine.ts to push the local dataset to Firestore.
// Keyed by uuid (buckets/transactions) or ticker (watchlist) rather than the
// local integer id, since only those are stable across devices. Includes
// soft-deleted rows - a deletion has to reach Firestore too, as a tombstone,
// not just an absence.

export interface SyncBucketRecord {
  uuid: string;
  name: string;
  yieldLow: number | null;
  yieldHigh: number | null;
  sortOrder: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncTransactionRecord {
  uuid: string;
  /** uuid of the owning bucket - not its local integer id. */
  bucketUuid: string;
  date: string | null;
  type: string | null;
  stock: string | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  currency: string | null;
  amount: number | null;
  rowHash: string;
  isManual: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncWatchlistRecord {
  ticker: string;
  buyBelowPrice: number | null;
  addedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncSettingsRecord {
  monthlyIncomeGoal: number | null;
  themeMode: 'system' | 'light' | 'dark';
  updatedAt: string;
}

export interface SyncSnapshot {
  buckets: SyncBucketRecord[];
  transactions: SyncTransactionRecord[];
  watchlist: SyncWatchlistRecord[];
  settings: SyncSettingsRecord;
}
