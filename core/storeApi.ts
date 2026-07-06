// core/storeApi.ts
// The one contract both platform implementations (db.native.ts, db.web.ts)
// must satisfy. Screens depend on THIS interface only, via useStore() -
// they never import expo-sqlite or idb directly, so the platform split is
// invisible above this layer.

import { RawRow, StoredTxn, Holding, AggregatedStock, BucketStockPosition, PortfolioSummary, RealizedTrade } from './bucketLogic';

export interface BucketRow {
  id: number;
  name: string;
  yield_low: number | null;
  yield_high: number | null;
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
  /** All-time dividends + realized gains for a bucket, including tickers that
   *  are now fully exited (and so no longer appear in getBucketPositions or
   *  in a naive sum of getBucketPositions()[].totalDividends). */
  getBucketLifetimeTotals(bucketName: string): Promise<{ totalRealizedGain: number; totalDividends: number; trades: RealizedTrade[] }>;
  /** Every BUY/SELL/CASH DIVIDEND transaction in a bucket, across all tickers
   *  (manual + imported), newest first - powers the bucket-level Transaction
   *  History view. */
  getBucketTransactionFeed(bucketName: string): Promise<{ date: string; type: string; ticker: string; quantity: number | null; price: number | null; amount: number | null }[]>;
}