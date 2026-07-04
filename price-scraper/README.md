# Price Cache Pipeline (Option A)

Scrapes `dividends.ph` once daily after PSE close, writes one static JSON
file, commits it back to the repo. Vercel redeploys automatically. Every
client fetches the same static file - no live scraping ever happens on a
client request, no backend, no CORS issue.

## How it fits together

1. `.github/workflows/refresh-prices.yml` runs on a cron (4:00 PM Manila
   time, weekdays) or manually via the Actions tab.
2. It runs `scripts/generate_price_cache.py`, which reads
   `scripts/tickers.json` and calls `scrape_dividends_ph.py` (unmodified -
   this is the same scraper built earlier, reused as-is since it never runs
   client-side) for each ticker.
3. Output is written to `public/data/prices.json`, merged with the previous
   file so a ticker that fails on a given run keeps its last-known value
   instead of disappearing.
4. The commit triggers a normal Vercel deploy. The frontend just does
   `fetch('/data/prices.json')` - same-origin static asset, works exactly
   like fetching any other file the build produces.

## Verified in this environment

- `generate_price_cache.py`'s merge/staleness logic - tested with a mocked
  scraper across two simulated runs (partial failures, a ticker recovering,
  a ticker going stale). Confirmed: successful tickers update, failed
  tickers keep their last good value rather than vanishing.
- The commit step's shell logic (`git diff --staged --quiet && ... && exit 0`)
  under `set -e`, which is GitHub Actions' default shell mode - confirmed
  correct in both the "changes to commit" and "nothing changed" branches.

## NOT verified

- The scraper itself against the live site (sandbox can't reach arbitrary
  websites - same caveat as `scrape_dividends_ph.py` always had).
- The GitHub Actions workflow hasn't actually run on GitHub's infrastructure.

## Extending the ticker list

Add tickers to `scripts/tickers.json` as you add holdings in other buckets.
The scraper doesn't know about your buckets - it just refreshes whatever's
listed here for the frontend to look up.
