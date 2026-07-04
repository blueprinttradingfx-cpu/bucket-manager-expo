"""
scripts/generate_price_cache.py

Runs once daily via GitHub Actions, after PSE market close. Scrapes every
ticker in tickers.json from dividends.ph, writes ONE static JSON file to
public/data/prices.json. Vercel serves that file like any other static
asset - clients fetch it same-origin, no CORS, no live scrape ever happens
on a client's request. This is Option A from scoping: scrape once,
centrally, on a schedule; every client reads the same cached result.

Reuses scrape_dividends_ph.py's get_price_and_yield() unmodified - proof
that keeping the scraper out of the deployed frontend meant zero porting.

Still carries the same caveat as scrape_dividends_ph.py itself: the
selectors are a best guess at dividends.ph's markup, unverified against
the live site from this sandboxed environment. Run this for real before
trusting the cron job.
"""

import json
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__) + "/..")
from scrape_dividends_ph import get_price_and_yield

TICKERS_PATH = os.path.join(os.path.dirname(__file__), "tickers.json")
# Was ../public/data/prices.json when this script lived at repo root
# (scripts/generate_price_cache.py). Now nested one level deeper
# (price-scraper/scripts/generate_price_cache.py) to merge into the Expo
# app's repo, so this needs one more ".." to land at repo-root public/data/
# - keeping the output path predictable regardless of where the pipeline
# itself lives.
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "public", "data", "prices.json")


def main():
    with open(TICKERS_PATH) as f:
        tickers = json.load(f)

    results = {}
    errors = {}
    for ticker in tickers:
        try:
            data = get_price_and_yield(ticker)
            results[ticker] = {"price": data["price"], "yieldPct": data["yield_pct"]}
        except Exception as e:
            # Don't let one broken ticker kill the whole batch - keep
            # yesterday's data implicitly by not overwriting it for this
            # ticker (see note below), and surface the failure for review.
            errors[ticker] = str(e)

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "tickers": results,
        "errors": errors,  # empty dict when everything succeeds
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    # Merge with previous file so a transient failure on one ticker doesn't
    # wipe its last-known price - stale-but-present beats missing entirely.
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            previous = json.load(f)
        merged_tickers = {**previous.get("tickers", {}), **results}
        output["tickers"] = merged_tickers

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {len(results)} tickers ({len(errors)} errors) to {OUTPUT_PATH}")
    if errors:
        print("Errors:", errors)


if __name__ == "__main__":
    main()
