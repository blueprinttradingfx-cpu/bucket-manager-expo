# price-scraper/scrape_dragonfi.py
#
# WHY THIS EXISTS: dividends.ph (the original source, see scrape_dividends_ph.py)
# turned out to lag real market prices by weeks for some tickers - confirmed
# independently: its own indexed snapshot for AREIT showed a price dated
# 6 May 2026, while dragonfi.ph's own AREIT/BPI pages reflect same-day PSE
# closes. dragonfi.ph is the more current source. This scraper switches to it.
#
# WHY IT NEEDS PLAYWRIGHT, NOT REQUESTS+BS4: confirmed directly - fetching
# https://dragonfi.ph/market/stocks/<ticker> with a plain HTTP GET returns
# only an empty SPA shell (meta tags + a Facebook pixel image, no price
# data anywhere in the HTML). The page is rendered entirely client-side;
# there's no server-rendered content for requests/BeautifulSoup to parse,
# unlike dividends.ph. A real (headless) browser is required to let the
# page's JS execute and populate the DOM before scraping it.
#
# PERFORMANCE FIX: the original version of this file launched a brand-new
# Chromium browser process PER TICKER (286 times for the full watchlist).
# Browser launch/close overhead alone is commonly 1-3s on a shared CI
# runner - across 286 tickers that's likely 20-40+ minutes of pure
# launch/close overhead before counting any actual page time, on top of
# the playwright install --with-deps chromium step (another 2-3 min) at
# the start of the workflow. This version launches ONE browser for the
# whole batch and reuses it (new page per ticker, not new browser) -
# should cut total runtime dramatically. Still sequential per-ticker
# (one page load at a time), which is intentional: concurrent page loads
# would hit dragonfi.ph faster/harder than a polite scraper should.
#
# UNVERIFIED IN THIS ENVIRONMENT - same caveat as before, unchanged: this
# sandbox can only reach package registries (pypi, npm, etc.), not
# arbitrary websites AND can't download the Playwright/Chromium binary
# itself (also blocked by the same restriction), so neither the original
# nor this rewritten version has ever actually loaded a real dragonfi.ph
# page from here. The text patterns below are reconstructed from a
# search-engine snapshot, same as before. Run this locally against a
# handful of real tickers before trusting the GitHub Actions run.
#
# SETUP (local verification):
#   pip install playwright
#   playwright install chromium
#   python scrape_dragonfi.py

import re
import time

from playwright.sync_api import sync_playwright, Browser

BASE_URL = "https://www.dragonfi.ph/market/stocks/{ticker}"
USER_AGENT = "Mozilla/5.0 (personal portfolio tool; contact: you@example.com)"


def _extract_price_and_yield(text: str, ticker: str) -> dict:
    """Pure text-parsing logic, split out from the browser interaction so it
    can be unit-tested against captured text without needing a real browser."""
    price_match = re.search(r"\u20b1\s*([\d,]+\.\d{2})\s*\(", text)
    if not price_match:
        price_match = re.search(r"\u20b1\s*([\d,]+\.\d{2})", text)

    yield_match = re.search(r"Dividend Yield\D{0,10}([\d.]+)\s*%", text)

    if not price_match:
        raise ValueError(
            f"Could not parse price for {ticker} from dragonfi.ph - "
            f"page structure may differ from what this scraper expects. "
            f"First 500 chars of rendered text: {text[:500]!r}"
        )

    return {
        "ticker": ticker.upper(),
        "price": float(price_match.group(1).replace(",", "")),
        "yield_pct": float(yield_match.group(1)) if yield_match else None,
    }


def get_price_and_yield(ticker: str, timeout_ms: int = 15000) -> dict:
    """Single-ticker convenience wrapper - launches its own browser. Fine for
    local testing against a handful of tickers; NOT what the batch job uses
    (see get_many below, which shares one browser across the whole list)."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            return _get_one(browser, ticker, timeout_ms)
        finally:
            browser.close()


def _get_one(browser: Browser, ticker: str, timeout_ms: int = 15000) -> dict:
    """Fetches one ticker using an ALREADY-LAUNCHED browser (new page/context
    per ticker, not new browser) - this is what makes the batch version fast."""
    url = BASE_URL.format(ticker=ticker.upper())
    page = browser.new_page(user_agent=USER_AGENT)
    try:
        page.goto(url, timeout=timeout_ms, wait_until="networkidle")
        page.wait_for_timeout(1500)
        text = page.inner_text("body")
    finally:
        page.close()
    return _extract_price_and_yield(text, ticker)


def get_many(tickers: list[str], delay_seconds: float = 1.0) -> list[dict]:
    """Batch fetch, ONE shared browser launched once for the whole list -
    this is the actual fix for the multi-minute runtime. Still sequential
    (one page at a time) and still has a polite delay between tickers, just
    without relaunching the browser process 286 times."""
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for t in tickers:
                try:
                    results.append(_get_one(browser, t))
                except Exception as e:
                    results.append({"ticker": t.upper(), "error": str(e)})
                time.sleep(delay_seconds)
        finally:
            browser.close()
    return results


if __name__ == "__main__":
    # Sanity check against a few tickers from your actual holdings.
    sample = ["AREIT", "MREIT", "FILRT", "DMC"]
    for row in get_many(sample):
        print(row)
