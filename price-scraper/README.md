# Price Cache Pipeline

Two independent GitHub Actions workflows keep `public/data/prices.json`
up to date - one primary, one backup - both writing to the same file.
Every client just fetches that one static JSON file: no live scraping on
a client request, no backend, no CORS issue.

## The two workflows

| Workflow | File | Source | Scope | Schedule |
|---|---|---|---|---|
| **Primary** | `refresh-prices-dragonfi.yml` | dragonfi.ph, falling back to dividends.ph per-ticker | Every ticker in `tickers.json` | 08:00 UTC (4:00 PM Manila) weekdays |
| **Backup** | `refresh-prices-filgit.yml` | filgit.com/pse-stocks | Only tickers the primary run couldn't get | 08:45 UTC - 45 min after primary |

**The backup fills gaps, it doesn't re-run everything.** If the primary
workflow already got a price for a ticker today, the backup leaves it
alone - it only touches tickers that are missing or listed under
`"errors"` in the current `prices.json`. This is deliberate: filgit's
snapshot is a different scrape at a different moment, and letting it
blindly overwrite a perfectly good primary-run price would just add
noise, not safety. See `generate_price_cache_filgit.py` for the gap logic.

## Why three sources are involved at all

- **dividends.ph** (original source) turned out to lag real prices by
  weeks for at least some tickers - confirmed independently: its AREIT
  snapshot was dated over a month behind the live PSE close.
- **dragonfi.ph** is fresher, but is a client-rendered SPA - a plain HTTP
  GET returns only an empty shell, no price data. `scrape_dragonfi.py`
  uses Playwright (headless Chromium) to actually render the page first.
- **filgit.com/pse-stocks** is *also* fresh (same trading-day data as
  dragonfi.ph when checked) and, unlike dragonfi.ph, is fully
  server-rendered - a plain `requests.get()` returns the whole stock
  table already populated. It lists the entire PSE across 3 pages in one
  cheap pass, which is what makes it a good gap-filling backup: three
  page fetches cover every ticker, instead of one request per ticker.
  Trade-off: it doesn't expose dividend yield in the plain-HTML view, so
  backup-filled tickers get `yieldPct: null` until the primary source
  succeeds on them again.

dividends.ph is kept as dragonfi's own per-ticker fallback (inside the
*primary* workflow, not the backup) - see `generate_price_cache.py`.

## How it fits together

1. **Primary run** (`refresh-prices-dragonfi.yml`): installs Playwright +
   Chromium, runs `generate_price_cache.py`, which tries
   `scrape_dragonfi.py` for each ticker in `tickers.json`, falling back to
   `scrape_dividends_ph.py` per-ticker on failure. Writes/merges into
   `public/data/prices.json`, tagging each entry with `"source"`.
2. **Backup run** (`refresh-prices-filgit.yml`), ~45 min later: installs
   only `requests`+`beautifulsoup4` (no browser needed), runs
   `generate_price_cache_filgit.py`, which reads the current
   `prices.json`, finds tickers missing or errored, scrapes filgit's
   pages 1-3 once, and fills only those gaps.
3. Both workflows' commit steps `git pull --rebase` before pushing, since
   two independent scheduled jobs write to the same file - staggering
   them by 45 minutes should avoid overlap in practice, but the rebase is
   a cheap safety net regardless.
4. The commit triggers a normal Vercel deploy. The frontend does
   `fetch('/data/prices.json')` - same-origin static asset.

Each ticker's entry in the output records which source produced it
(`"source": "dragonfi" | "dividends.ph" | "filgit"`), so you can always
see in the committed JSON whether a given price came from the primary
chain or the backup - nothing is silently blended.

## Verified in this environment

- `generate_price_cache.py`'s dragonfi-then-dividends.ph fallback and
  merge-with-previous logic.
- `generate_price_cache_filgit.py`'s gap-detection logic (missing vs.
  errored tickers) and that it leaves already-successful tickers
  untouched.
- Both commit steps' shell logic under `set -e` (GitHub Actions' default),
  in both the "changes to commit" and "nothing changed" branches.
- That `dividends.ph`'s own indexed data is genuinely stale for at least
  one real holding (AREIT) - confirmed via search, not just suspected.
- That `dragonfi.ph`'s stock pages are client-rendered SPAs (empty shell
  on plain fetch) and that `filgit.com/pse-stocks` is server-rendered
  (full table present on plain fetch) - both confirmed by directly
  fetching each page.

## NOT verified - run these for real before trusting the cron jobs

- `scrape_dragonfi.py`'s selectors against the live, JS-rendered page -
  this sandbox can't run Playwright against arbitrary websites. See the
  file's own header comment for the local verification steps.
- `scrape_filgit.py`'s selectors against the live page, beyond the fetched
  snapshot used to write it. The row-parsing logic (first `₱`-prefixed
  number in a row = Stock Price) was checked against every row in that
  snapshot, including edge cases, but "checked against a snapshot" isn't
  the same as "ran against the live site."
- Neither GitHub Actions workflow has actually run on GitHub's
  infrastructure yet.

**Before relying on this**, run locally:

```bash
cd price-scraper
pip install -r requirements.txt
playwright install chromium      # only needed for scrape_dragonfi.py

python scrape_dragonfi.py        # prints results for 4 sample tickers
python scrape_filgit.py          # prints total scraped + 5 sample tickers
```

If a ticker raises `ValueError` or comes back `NOT FOUND`, the scrapers
print enough of what they actually saw to fix the regex/selector.

## If either site's structure has changed by the time you read this

For dragonfi.ph specifically, the fastest robust fix isn't guessing at
regexes - it's finding the JSON API its own frontend calls (DevTools →
Network → Fetch/XHR on a stock page). That would let `scrape_dragonfi.py`
drop Playwright entirely in favor of a plain `requests.get()`.

## Extending the ticker list

Add tickers to `scripts/tickers.json` as you add holdings in other
buckets. Both workflows read from the same list - the primary tries to
price all of them, the backup only steps in for whichever ones the
primary couldn't.
