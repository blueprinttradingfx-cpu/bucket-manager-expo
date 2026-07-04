# UNTESTED IN THIS ENVIRONMENT - the sandbox this was built in can only reach
# package registries (pypi, npm, etc.), not arbitrary websites. Run this
# locally with `pip install requests beautifulsoup4` and verify against a
# few tickers before wiring it into bucket_store.py.
#
# Confirmed via manual fetch during scoping: https://dividends.ph/company/MER
# renders price as "\u20b1585.00" near the top and a Fundamentals table row
# "Dividend Yield | 4.79%". Selectors below are a best-effort guess at the
# underlying HTML structure - inspect the real page source and adjust.

import re
import time
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://dividends.ph/company/{ticker}"
HEADERS = {"User-Agent": "Mozilla/5.0 (personal portfolio tool; contact: you@example.com)"}


def get_price_and_yield(ticker: str, timeout: int = 10) -> dict:
    """Fetch current price and dividend yield for a PSE ticker from dividends.ph.
    Returns {'ticker', 'price', 'yield_pct'} - yield_pct is None for companies
    that don't pay dividends (confirmed real case: their page shows literal
    "Dividend Yield | N/A", not a percentage - this is a valid state, not a
    scrape failure, and roughly 100+ of the PSE's 286 listed companies are
    in this category). Raises ValueError only if PRICE can't be found, since
    that would indicate a genuinely broken/missing page.
    """
    url = BASE_URL.format(ticker=ticker.upper())
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    text = soup.get_text(" ", strip=True)

    # Price appears as e.g. "\u20b1585.00" right after the ticker heading.
    price_match = re.search(r"\u20b1\s*([\d,]+\.\d{2})", text)
    # Dividend Yield appears as a labeled fundamentals row, e.g. "Dividend Yield 4.79%"
    # - or "Dividend Yield N/A" for non-payers, which simply won't match this pattern.
    yield_match = re.search(r"Dividend Yield\s*([\d.]+)\s*%", text)

    if not price_match:
        raise ValueError(f"Could not parse price for {ticker} - page structure may have changed")

    return {
        "ticker": ticker.upper(),
        "price": float(price_match.group(1).replace(",", "")),
        "yield_pct": float(yield_match.group(1)) if yield_match else None,
    }


def get_many(tickers: list[str], delay_seconds: float = 1.5) -> list[dict]:
    """Fetch several tickers with a polite delay between requests."""
    results = []
    for t in tickers:
        try:
            results.append(get_price_and_yield(t))
        except Exception as e:
            results.append({"ticker": t.upper(), "error": str(e)})
        time.sleep(delay_seconds)
    return results


if __name__ == "__main__":
    # Sanity check against a few tickers from your actual Bucket 5 holdings
    sample = ["MER", "MREIT", "AREIT", "DMC"]
    for row in get_many(sample):
        print(row)
