// core/storeApi.ts
// The one contract both platform implementations (db.native.ts, db.web.ts)
// must satisfy. Screens depend on THIS interface only, via useStore() -
// they never import expo-sqlite or idb directly, so the platform split is
// invisible above this layer.

import { RawRow, StoredTxn, Holding, AggregatedStock, BucketStockPosition, PortfolioSummary } from './bucketLogic';

export interface BucketRow {
  id: number;
  name: string;
  yield_low: number | null;
  yield_high: number | null;
}

export interface BucketStoreAPI {
  listBuckets(): Promise<BucketRow[]>;
  getOrCreateBucket(name: string, yieldLow?: number, yieldHigh?: number): Promise<number>;
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
  /** Specific stock + bucket drill-down: individual dividend payments. */
  getDividendHistory(bucketName: string, ticker: string): Promise<{ date: string; amount: number }[]>;
}
