"""
scripts/generate_price_cache_filgit.py

The BACKUP half of the two-workflow pipeline (see
price-scraper/README.md). Runs separately from
scripts/generate_price_cache.py (the dragonfi/dividends.ph primary), on
its own schedule, writing into the SAME public/data/prices.json.

Deliberately does NOT re-scrape or overwrite every ticker - that would
make "backup" meaningless, since a fresher primary-run price could get
clobbered by filgit's (potentially different-second) snapshot. Instead:

1. Load the current prices.json.
2. Find the GAP: tickers in tickers.json that are either missing from
   the cache entirely, or listed in "errors" (meaning the primary run's
   dragonfi-then-dividends.ph chain failed on them for the day).
3. Scrape all of filgit's pages 1-3 (cheap - 3 requests total, no per-
   ticker cost) and use it ONLY to fill those specific gap tickers.
4. Everything the primary run already got a price for is left untouched.

If there's no gap (primary run succeeded on everything), this still runs
the scrape (harmless) but writes nothing new - the point is being ready
to fill gaps, not to second-guess a working primary result.
"""

import json
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__) + "/..")
from scrape_filgit import get_all_pages

TICKERS_PATH = os.path.join(os.path.dirname(__file__), "tickers.json")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "public", "data", "prices.json")


def main():
    with open(TICKERS_PATH) as f:
        watchlist = json.load(f)

    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            cache = json.load(f)
    else:
        # No primary run has ever produced a cache file - treat everything
        # as a gap, so the backup can still bootstrap a first version.
        cache = {"generatedAt": None, "tickers": {}, "errors": {}}

    existing_tickers = cache.get("tickers", {})
    existing_errors = cache.get("errors", {})

    gap = [t for t in watchlist if t not in existing_tickers or t in existing_errors]

    if not gap:
        print("No gap - every watchlist ticker already has a price from the primary run. Nothing to backfill.")
        # Still record that the backup checked in, without touching tickers/errors.
        cache["backupCheckedAt"] = datetime.now(timezone.utc).isoformat()
        with open(OUTPUT_PATH, "w") as f:
            json.dump(cache, f, indent=2)
        return

    print(f"Gap tickers needing backfill: {gap}")
    filgit_prices = get_all_pages()  # scrapes pages 1-3 once, regardless of gap size

    filled = []
    still_missing = []
    for ticker in gap:
        entry = filgit_prices.get(ticker)
        if entry is not None:
            existing_tickers[ticker] = {"price": entry["price"], "yieldPct": None, "source": "filgit"}
            existing_errors.pop(ticker, None)
            filled.append(ticker)
        else:
            existing_errors[ticker] = existing_errors.get(ticker, "") + " | filgit backup: ticker not found in pse-stocks listing"
            still_missing.append(ticker)

    cache["tickers"] = existing_tickers
    cache["errors"] = existing_errors
    cache["backupCheckedAt"] = datetime.now(timezone.utc).isoformat()
    # generatedAt intentionally left as whatever the primary run last set -
    # a partial backfill from a backup source shouldn't claim the whole
    # cache is as fresh as a full primary run.

    with open(OUTPUT_PATH, "w") as f:
        json.dump(cache, f, indent=2)

    print(f"Backfilled {len(filled)} tickers from filgit: {filled}")
    if still_missing:
        print(f"Still missing after backup ({len(still_missing)}): {still_missing}")


if __name__ == "__main__":
    main()
