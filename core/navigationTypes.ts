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
  // Scoped to DashboardStack only for now - Dashboard > Positions is the
  // only place that currently distinguishes fund rows from stock rows
  // before navigating (Buckets/WatchList's ticker links all originate from
  // stock-only sources: PSE universe search, bucket finder). See
  // FundDetailScreen.tsx's header comment for why this is a separate
  // screen/route from StockDetail rather than a shared one.
  FundDetail: { ticker: string };
  StockInBucket: { bucket: string; ticker: string };
  SearchStock: undefined;
  MonthlyDividendIncome: { bucket?: string };
  // Market-wide context (PSEi, sentiment, movers, dividends/macro
  // calendars) - scoped to DashboardStack only, same as FundDetail above,
  // since MarketPulseCard (the only entry point) lives on DashboardHome.
  MarketPulse: undefined;
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

export type WatchListStackParamList = {
  WatchListHome: undefined;
  StockDetail: { ticker: string };
  StockInBucket: { bucket: string; ticker: string };
  SearchStock: undefined;
};

export type TrackerStackParamList = {
  StockTrackerHome: undefined;
  StockDetail: { ticker: string };
  SearchStock: undefined;
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Account: undefined;
  Support: undefined;
  About: undefined;
  Contact: undefined;
  TermsOfUse: undefined;
  PrivacyPolicy: undefined;
  BucketStrategyInfo: undefined;
  AllNotes: { tickerFilter?: string };
  AllTags: { tagFilter?: string } | undefined;
  AllAlerts: { tickerFilter?: string } | undefined;
  ImportStatement: undefined;
  StockTracker: undefined;
  StockDetail: { ticker: string };
};

// The Tab.Navigator itself (App.tsx) - each tab screen is registered via a
// render-prop child rather than `component={...}`, but that's a JSX
// authoring detail; it doesn't change what linking (core/linking.ts) needs
// to target, which is the navigation state tree these tabs produce at
// runtime.
export type RootTabParamList = {
  Dashboard: undefined;
  Buckets: undefined;
  StockTracker: undefined;
  WatchList: undefined;
  Import: undefined;
  Settings: undefined;
};

// React Navigation's documented pattern for typing NavigationContainer's
// `linking` prop (and useNavigation()/navigate() calls elsewhere) against
// the app's actual root param list, instead of the untyped default
// (ParamListBase) it otherwise falls back to. This project never declared
// it before now - added alongside core/linking.ts since that's the first
// thing that actually surfaced the gap as a real tsc error.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootTabParamList {}
  }
}
