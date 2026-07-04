// core/navigationTypes.ts
// Shared param list types for both stacks. StockInBucket is reachable from
// either stack (DashboardStack via StockDetail, BucketsStack via
// BucketDetail), so both param lists declare it identically.

export type DashboardStackParamList = {
  DashboardHome: undefined;
  StockDetail: { ticker: string };
  StockInBucket: { bucket: string; ticker: string };
};

export type BucketsStackParamList = {
  BucketsHome: undefined;
  BucketDetail: { bucket: string };
  StockInBucket: { bucket: string; ticker: string };
};
