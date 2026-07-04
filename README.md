# Bucket Portfolio Manager (Expo Universal)

A local-first, no-backend multi-bucket portfolio manager for DragonFi.
One codebase, targets iOS, Android, AND web (via react-native-web) - same
screens, same App.tsx, same core logic. Only the storage layer is
platform-specific (SQLite native, IndexedDB web), resolved automatically
by Metro's `.native.ts` / `.web.ts` file suffix convention.

See `bucket-portfolio-manager-scope.md` for full design rationale.

## Information architecture (4 views, drill-down)

1. **Main aggregated dashboard** (`DashboardScreen`) - portfolio-wide
   totals, allocation-by-bucket bar, and one row per TICKER merged across
   every bucket that holds it. Tap a stock to drill in.
2. **Per-bucket view** (`BucketDetailScreen`) - everything held within one
   specific bucket, dividends included per stock. Reached by tapping a
   bucket on the Buckets tab.
3. **Aggregated stock view** (`StockDetailScreen`) - one ticker, merged
   across every bucket that holds it: total value, blended avg cost, total
   dividends, and which buckets it's split across. Tap a bucket row to
   drill in further.
4. **Specific stock + bucket view** (`StockInBucketScreen`) - the most
   granular level: one ticker, in one bucket, specifically - position
   detail plus the actual dividend payment history (dates + amounts).
   Reachable from either drill-down path (registered in both stacks).

All transaction types are stored (`BUY`, `SELL`, `CASH DIVIDEND`,
`DEPOSIT`, `WITHDRAWAL`, `ADJUSTMENT`) - dividend tracking was a read-side
gap, not a data gap; the rows were always there, nothing queried them
until this pass.

## Status

**Verified in this environment:**
- `core/bucketLogic.ts` (FIFO reconstruction + dedup) - tested via
  `test/run.ts`, which now imports the REAL production parsing code
  (`core/xlsxRows.ts`) instead of a separate test-only reimplementation -
  see "Bugs found" below for why that change mattered.
- `core/db.web.ts` (the REAL IndexedDB implementation) - tested via
  `test/run.web.ts` using `fake-indexeddb`. Identical results to native/Python.
- Whole project type-checks under BOTH platform resolutions.
- `npx expo export --platform web` succeeds - real build, 525 modules,
  working `dist/index.html` + JS bundle + assets.

**Bugs found and fixed after "import did nothing, no logs" report:**

1. **Date parsing was broken, and had been the whole time.** `xlsxRows.ts`'s
   date formatter used `new Date(v)` on what turned out to be a plain
   `"DD/MM/YYYY"` string (not a JS Date object - `cellDates: true` has no
   effect because DragonFi's Date column is text-formatted, not a real
   Excel date cell). JS's string-to-Date parsing guesses MM/DD/YYYY for
   slash-separated dates, which either fails outright (day > 12, giving
   `NaN/NaN/NaN`) or silently swaps day and month (day <= 12, giving a
   wrong-but-valid-looking date). This was NEVER caught earlier because
   `test/run.ts` had its own separate, correct date-parsing logic written
   just for the test - it was testing different code than what shipped.
   Fixed by detecting the already-correctly-formatted string case directly
   (no reparsing needed) and rewriting `test/run.ts` to import the real
   `xlsxRows.ts` function instead of duplicating it.
2. **Web file reading likely didn't work at all.** `expo-file-system`'s
   `readAsStringAsync` targets native file:// paths and has weak/unreliable
   support for the `blob:` URLs a browser file picker returns - the likely
   cause of the original silent failure on web. Fixed by splitting
   `xlsxImport.ts` into `xlsxImport.native.ts` (unchanged) and
   `xlsxImport.web.ts` (uses a plain `<input type="file">` + the browser's
   native `File.arrayBuffer()` instead of expo-file-system).
3. Extracted the shared row-mapping logic into `core/xlsxRows.ts` after an
   initial mistake where `xlsxImport.web.ts` imported directly from
   `xlsxImport.native.ts` - which would have pulled native-only
   `expo-document-picker`/`expo-file-system` code into the web bundle.
   Same shared-core pattern as `bucketLogic.ts`.
4. Added `console.log` at every step of the import flow (picker open,
   file selected/cancelled, rows parsed, import result) so a future
   failure is diagnosable instead of silent.

**NOT verified - needs a real device or simulator:**
- The fixed web file picker hasn't been clicked in an actual browser yet -
  this environment can `export` but can't interact with a live page.
- Running on Android/iOS specifically.
- The dividends.ph scraper (`core/scraper.ts`).

If import still does nothing after this fix: check the browser console
(F12 -> Console tab) for the `[ImportScreen]` / `[xlsxImport.web]` log
lines now in place - they'll show exactly which step it stopped at.


## Live price data (NEW)

`core/priceCache.ts` fetches the static price/yield JSON produced by the
separate GitHub Actions pipeline (see `bucket-manager-web.zip` from
earlier scoping - `scripts/generate_price_cache.py` +
`.github/workflows/refresh-prices.yml`). Works identically on native AND
web with zero platform split, because `raw.githubusercontent.com` serves
`Access-Control-Allow-Origin: *` (verified directly via `curl -sI`) - the
CORS restriction that forced xlsx-import to split by platform simply
doesn't apply here.

**Action needed from you:** `DEFAULT_PRICE_CACHE_URL` in
`core/priceCache.ts` is currently a placeholder
(`YOUR_USERNAME`/`YOUR_REPO`). Once you push the price-cache pipeline repo
to GitHub and its Action has run at least once, update that URL to your
actual repo path. Until then, the app correctly degrades to cost-basis-only
(tested: the placeholder URL throws a clean 404, caught and handled -
Dashboard and Stock Detail show a small warning instead of crashing).

New computed fields when prices ARE available: market value, unrealized
gain/loss (₱ and %), current yield per stock, total portfolio return
(dividends + unrealized gain combined). All pure functions in
`bucketLogic.ts` (`applyPricesToPositions`, `applyPricesToAggregated`,
`computePortfolioValuation`) - tested against real holdings data with
deliberately mixed price coverage (one up, one down, one exactly flat,
several missing entirely) to confirm unpriced tickers are excluded from
gain/loss math rather than silently treated as zero.

## Setup

```bash
npm install
npx expo start        # then press 'a' (Android), 'i' (iOS), or 'w' (web)
npx expo export --platform web   # produces a static build, deployable to Vercel
```

## Re-running the tests

```bash
npm run test:core        # pure FIFO/dedup logic
npm run test:web-store   # actual IndexedDB implementation via fake-indexeddb
npx tsc --noEmit -p tsconfig.native.json   # type-check as native would resolve
npx tsc --noEmit -p tsconfig.web.json      # type-check as web would resolve
```

## Project structure

```
core/
  bucketLogic.ts        - pure FIFO/dedup logic, zero platform dependency
  storeApi.ts             - the shared interface both storage implementations honor
  db.native.ts            - SQLite implementation (iOS/Android)
  db.web.ts                 - IndexedDB implementation (web)
  StoreProvider.native.tsx  - wraps expo-sqlite, exposes useStore()
  StoreProvider.web.tsx      - wraps IndexedDB open, exposes useStore()
  xlsxImport.ts                - file picker + xlsx parsing (native-focused; verify on web)
  scraper.ts                    - dividends.ph price/yield fetcher
screens/
  BucketsScreen.tsx    - configure buckets (name + yield bracket) - platform-agnostic
  ImportScreen.tsx     - select bucket -> import statement file - platform-agnostic
  DashboardScreen.tsx  - aggregated holdings across all buckets - platform-agnostic
App.tsx               - navigation + StoreProvider, identical across platforms
test/
  run.ts        - tests core/bucketLogic.ts
  run.web.ts    - tests the real core/db.web.ts via fake-indexeddb
```

## Known open items (from scoping)

- Full transaction history vs. opening-balance seeding - importing a
  recent-window export can orphan SELL rows with no matching BUY in the
  data set. Detected and reported, not yet resolved with a UI.
- Scraper selectors are a best guess at dividends.ph's markup - verify
  against the live site.
- `xlsxImport.ts`'s file-picker flow needs verification on web - browser
  file input behaves differently from native's DocumentPicker.
- Price/yield data isn't wired into the UI yet - see the separate price
  cache pipeline (`bucket-manager-web.zip`) for the daily-scrape approach;
  connecting it to Buckets/Dashboard screens is still open.
