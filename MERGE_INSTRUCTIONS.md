# Merging the price-scraper into your bucket-manager-expo repo

You've already pushed `bucket-manager-expo` to GitHub. This adds the price
pipeline into that SAME repo, so you only manage one.

## What's in this zip

```
.github/workflows/refresh-prices.yml   - the daily cron job
price-scraper/
  scrape_dividends_ph.py                - the scraper
  scripts/
    generate_price_cache.py             - batch runner, writes public/data/prices.json
    tickers.json                        - watchlist
```

Paths inside these files were adjusted (and tested - see below) to work
correctly nested one level deeper than their original location, so the
output still lands at repo-root `public/data/prices.json`, not buried
inside `price-scraper/`.

## Steps

1. Copy both the `.github/` folder and `price-scraper/` folder into your
   existing local `bucket-manager-expo` clone, at the repo root (same
   level as `App.tsx`, `package.json`).
2. Commit and push:
   ```bash
   git add .github price-scraper
   git commit -m "Add price cache scraper pipeline"
   git push
   ```
3. Go to your repo's **Actions** tab on GitHub. You should see "Refresh
   price cache" listed. Click it, then **Run workflow** (this uses the
   `workflow_dispatch` trigger already in the workflow file - no need to
   wait for tomorrow's scheduled run).
4. Check the run's logs. This is the actual first contact with the live
   `dividends.ph` site - the scraper's selectors have only been logic-
   tested until now, never network-tested against the real page. If a
   ticker fails to parse, you'll see it in the "Errors" output.
5. If it succeeds, `public/data/prices.json` will appear as a new commit
   in your repo. Grab this URL:
   ```
   https://raw.githubusercontent.com/<your-username>/bucket-manager-expo/main/public/data/prices.json
   ```
6. Paste that into `DEFAULT_PRICE_CACHE_URL` in
   `core/priceCache.ts`, replacing the `YOUR_USERNAME`/`YOUR_REPO`
   placeholder. Commit, push, and the Dashboard/Stock Detail screens will
   start showing live market value and unrealized gain/loss on next load.

## Verified before packaging

- The adjusted relative paths (script now nested under `price-scraper/scripts/`
  instead of repo-root `scripts/`) were tested with a mocked scraper -
  confirmed output correctly lands at repo-root `public/data/prices.json`,
  not nested under `price-scraper/`.

## Not verified

- The actual scraper run against the live `dividends.ph` site - this can
  only happen once it's actually running on GitHub's infrastructure (step
  4 above).
