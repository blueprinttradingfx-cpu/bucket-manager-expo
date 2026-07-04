"""
scripts/generate_price_cache.py

Runs once daily via GitHub Actions, after PSE market close. Scrapes every
ticker in tickers.json, writes ONE static JSON file to
public/data/prices.json. Vercel serves that file like any other static
asset - clients fetch it same-origin, no CORS, no live scrape ever happens
on a client's request. This is Option A from scoping: scrape once,
centrally, on a schedule; every client reads the same cached result.

SOURCE: dragonfi.ph is now primary (see scrape_dragonfi.py for why -
dividends.ph was confirmed to lag real prices by weeks for at least some
tickers). dividends.ph is kept as a per-ticker FALLBACK: if dragonfi.ph's
scrape fails for a given ticker (page structure changed, transient error,
timeout, etc.), that ticker falls back to dividends.ph rather than losing
the update entirely for the day. Both sources' errors are recorded so a
ticker that fails on both is visible in the output, not silently stale.

Same caveat both individual scrapers carry: dragonfi.ph's selectors are
unverified against the live site from this sandboxed environment. Run
this for real (see price-scraper/README.md) before trusting the cron job.
"""

import json
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__) + "/..")
from scrape_dragonfi import get_price_and_yield as get_from_dragonfi
from scrape_dividends_ph import get_price_and_yield as get_from_dividends_ph

TICKERS_PATH = os.path.join(os.path.dirname(__file__), "tickers.json")
# Was ../public/data/prices.json when this script lived at repo root
# (scripts/generate_price_cache.py). Now nested one level deeper
# (price-scraper/scripts/generate_price_cache.py) to merge into the Expo
# app's repo, so this needs one more ".." to land at repo-root public/data/
# - keeping the output path predictable regardless of where the pipeline
# itself lives.
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "public", "data", "prices.json")


def fetch_one(ticker: str) -> tuple[dict | None, str | None]:
    """Try dragonfi.ph first (fresher), fall back to dividends.ph per-ticker
    if that fails. Returns (result_dict_or_None, error_string_or_None)."""
    try:
        data = get_from_dragonfi(ticker)
        return {"price": data["price"], "yieldPct": data["yield_pct"], "source": "dragonfi"}, None
    except Exception as dragonfi_error:
        try:
            data = get_from_dividends_ph(ticker)
            return {"price": data["price"], "yieldPct": data["yield_pct"], "source": "dividends.ph"}, None
        except Exception as fallback_error:
            return None, f"dragonfi: {dragonfi_error} | dividends.ph fallback: {fallback_error}"


def main():
    with open(TICKERS_PATH) as f:
        tickers = json.load(f)

    results = {}
    errors = {}
    for ticker in tickers:
        result, error = fetch_one(ticker)
        if result is not None:
            results[ticker] = result
        else:
            errors[ticker] = error

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "tickers": results,
        "errors": errors,  # empty dict when everything succeeds
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    # Merge with previous file so a transient failure on one ticker (on
    # BOTH sources) doesn't wipe its last-known price - stale-but-present
    # beats missing entirely.
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            previous = json.load(f)
        merged_tickers = {**previous.get("tickers", {}), **results}
        output["tickers"] = merged_tickers

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    sources_used = {t: r["source"] for t, r in results.items()}
    print(f"Wrote {len(results)} tickers ({len(errors)} errors) to {OUTPUT_PATH}")
    print("Sources used:", sources_used)
    if errors:
        print("Errors:", errors)


if __name__ == "__main__":
    main()
