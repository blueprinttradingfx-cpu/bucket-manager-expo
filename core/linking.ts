// core/linking.ts
// Pre-launch pass (2026-07-26). Gives each screen a real path instead of
// everything living behind '/' as an opaque client-side-only SPA state.
// Two reasons this exists, in order of urgency:
//   1. Google Play requires a *hosted, public URL* for the privacy policy
//      in the Play Console listing (see PrivacyPolicyScreen.tsx's header
//      comment) - without a `linking` config, the Vercel-hosted web build
//      never updates window.location, so there was no such URL to submit,
//      even though the page itself existed and rendered fine.
//   2. ani://... deep links on iOS/Android (scheme set in app.config.js),
//      e.g. a future "open your synced portfolio" email link.
//
// On web this is handled by react-navigation's own history integration -
// vercel.json already rewrites every path to index.html (`"source":
// "/(.*)"`), which is exactly what a client-side-routed SPA needs so any
// path (e.g. /privacy-policy) still serves the app shell and lets this
// config pick the right screen from the URL. No vercel.json change needed.
//
// Path design notes:
// - Static segments deliberately share a depth with a dynamic sibling in a
//   few places (e.g. Buckets' `why-multiple-buckets` alongside
//   `BucketDetail`'s `:bucket`). React Navigation resolves this by matching
//   static patterns before parametric ones, so a bucket literally named
//   "why-multiple-buckets" is the only way to hit that ambiguity, and even
//   then the static screen wins - documented, standard router precedence,
//   not a home-grown assumption.
// - StockDetail/StockInBucket/MonthlyDividendIncome/BucketStrategyInfo are
//   registered in more than one stack (see navigationTypes.ts's header
//   comment for why); each stack's copy gets its own path so there's no
//   cross-tab collision.

import { LinkingOptions } from '@react-navigation/native';
import { RootTabParamList } from './navigationTypes';

export const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ['https://bucket-manager-zeta.vercel.app', 'ani://'],
  config: {
    screens: {
      Dashboard: {
        screens: {
          DashboardHome: '',
          StockDetail: 'stock/:ticker',
          FundDetail: 'fund/:ticker',
          StockInBucket: 'stock/:ticker/in/:bucket',
          SearchStock: 'search',
          MonthlyDividendIncome: 'dividends/:bucket?',
          MarketPulse: 'market',
        },
      },
      Buckets: {
        path: 'buckets',
        screens: {
          BucketsHome: '',
          BucketDetail: ':bucket',
          StockDetail: 'stock/:ticker',
          StockInBucket: ':bucket/:ticker',
          EditBucket: 'edit/:bucketId',
          BucketStrategyInfo: 'why-multiple-buckets',
          MonthlyDividendIncome: 'dividends/:bucket?',
        },
      },
      StockTracker: {
        path: 'tracker',
        screens: {
          StockTrackerHome: '',
          StockDetail: 'stock/:ticker',
          SearchStock: 'search',
        },
      },
      WatchList: {
        path: 'watchlist',
        screens: {
          WatchListHome: '',
          StockDetail: 'stock/:ticker',
          StockInBucket: ':bucket/:ticker',
          SearchStock: 'search',
        },
      },
      Import: 'import',
      Settings: {
        screens: {
          SettingsHome: 'settings',
          Account: 'settings/account',
          Support: 'settings/support',
          BucketStrategyInfo: 'settings/why-multiple-buckets',
          AllNotes: 'settings/notes',
          AllTags: 'settings/tags',
          AllAlerts: 'settings/alerts',
          ImportStatement: 'settings/import',
          StockTracker: 'settings/tracker',
          // Deliberately top-level rather than nested under settings/ - the
          // Play Console privacy-policy URL should be short and shareable,
          // not implementation detail about which tab it lives under.
          About: 'about',
          Contact: 'contact',
          TermsOfUse: 'terms',
          PrivacyPolicy: 'privacy-policy',
        },
      },
    },
  },
};
