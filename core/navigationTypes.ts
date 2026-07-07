// core/navigationTypes.ts
// Shared param list types for both stacks. StockInBucket is reachable from
// either stack (DashboardStack via StockDetail, BucketsStack via
// BucketDetail), so both param lists declare it identically. Same story for
// MonthlyDividendIncome - reachable from DashboardHome (bucket omitted =
// aggregated across all buckets) and from BucketDetail (bucket set = scoped
// to just that one).

export type DashboardStackParamList = {
  DashboardHome: undefined;
  StockDetail: { ticker: string };
  StockInBucket: { bucket: string; ticker: string };
  SearchStock: undefined;
  MonthlyDividendIncome: { bucket?: string };
};

export type BucketsStackParamList = {
  BucketsHome: undefined;
  BucketDetail: { bucket: string };
  StockDetail: { ticker: string };
  StockInBucket: { bucket: string; ticker: string };
  EditBucket: { bucketId: number };
  MonthlyDividendIncome: { bucket?: string };
  BucketStrategyInfo: undefined;
};
