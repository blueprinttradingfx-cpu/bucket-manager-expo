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
# UNVERIFIED IN THIS ENVIRONMENT - same caveat as scrape_dividends_ph.py
# originally carried, for the same reason: this sandbox can only reach
# package registries (pypi, npm, etc.), not arbitrary websites, so this has
# never actually loaded a real dragonfi.ph page. The text patterns below
# ("₱101.00", "Dividend Yield 4.81%", "Market Closed") are reconstructed
# from a search-engine snapshot of https://www.dragonfi.ph/market/stocks/BPI,
# which itself may reformat/collapse whitespace differently than the live
# DOM does. Run `python scrape_dragonfi.py` locally against a few real
# tickers before wiring this into the GitHub Actions pipeline, and adjust
# the regexes/selectors to match what you actually see.
#
# SETUP (local verification):
#   pip install playwright
#   playwright install chromium
#   python scrape_dragonfi.py

import re
import time

from playwright.sync_api import sync_playwright

BASE_URL = "https://www.dragonfi.ph/market/stocks/{ticker}"
USER_AGENT = "Mozilla/5.0 (personal portfolio tool; contact: you@example.com)"


def get_price_and_yield(ticker: str, timeout_ms: int = 15000) -> dict:
    """Fetch current price and dividend yield for a PSE ticker from
    dragonfi.ph. Returns {'ticker', 'price', 'yield_pct'} - yield_pct is
    None for non-dividend-payers (same "N/A" case as dividends.ph had).
    Raises ValueError only if PRICE can't be found.

    Uses a fresh headless browser context per call rather than sharing one
    across get_many()'s loop - slower, but avoids any session/cache state
    bleeding between tickers, which matters more than speed for a batch
    job that runs once a day.
    """
    url = BASE_URL.format(ticker=ticker.upper())
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, timeout=timeout_ms, wait_until="networkidle")
            # Give client-side data fetches a moment past networkidle -
            # some SPAs kick off a second round of requests after the
            # first paint. Adjust/remove once you've watched this run for
            # real and know whether it's actually needed.
            page.wait_for_timeout(1500)
            text = page.inner_text("body")
        finally:
            browser.close()

    # Price: "₱101.00" near the top, immediately followed by a
    # percentage-change figure in parens, e.g. "₱101.00 (0.00%)".
    price_match = re.search(r"\u20b1\s*([\d,]+\.\d{2})\s*\(", text)
    if not price_match:
        # Fallback: just the first ₱-prefixed number anywhere, in case the
        # "(change%)" isn't adjacent the way the search snapshot suggested.
        price_match = re.search(r"\u20b1\s*([\d,]+\.\d{2})", text)

    # Dividend Yield row, e.g. "Dividend Yield 4.81%" or "...N/A" for
    # non-payers (which simply won't match this pattern - not an error).
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
    # Sanity check against a few tickers from your actual holdings.
    sample = ["AREIT", "MREIT", "FILRT", "DMC"]
    for row in get_many(sample):
        print(row)
