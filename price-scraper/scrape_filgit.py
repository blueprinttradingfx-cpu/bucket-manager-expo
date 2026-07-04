# price-scraper/scrape_filgit.py
#
# BACKUP price source. filgit.com/pse-stocks lists ALL ~315 PSE-listed
# tickers across 3 pages (page 1 = largest market cap ... page 3 =
# smallest), sorted by market cap. Confirmed directly: unlike dragonfi.ph,
# this page IS server-rendered - a plain HTTP GET returns the full stock
# table already populated in the HTML, no browser/JS needed. Its "Data as
# of" date also matched the same live trading day as dragonfi.ph's own
# pages when checked, so freshness is comparable - dividends.ph was the
# only one of the three confirmed stale.
#
# NO DIVIDEND YIELD from this source: the listing table's default columns
# are Stock / Stock Name / Stock Price / Change / Traded Amount / Market
# Cap / Change / 52-Week High / 52-Week Low. filgit's UI advertises an
# "Annual Dividend Yield" column you can add via its column picker, but
# that's a client-side toggle (likely AJAX-driven) - not present in the
# plain-GET HTML this scraper reads. So filgit only ever fills in `price`,
# never `yield_pct`. That's fine for its role here: it's a PRICE backup,
# not a dividend-data source (dividends.ph and dragonfi.ph both still
# supply yield when they're the ones that succeed).
#
# UNVERIFIED IN THIS ENVIRONMENT - same standing caveat as the other two
# scrapers: this sandbox can't reach arbitrary websites, so this has only
# been checked against a fetched snapshot of filgit.com, not run live.
# Run `python scrape_filgit.py` locally before wiring it into the backup
# workflow.

import re
import time

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://filgit.com/pse-stocks?page={page}"
HEADERS = {"User-Agent": "Mozilla/5.0 (personal portfolio tool; contact: you@example.com)"}

# Matches each row's ticker link, e.g. href="https://filgit.com/areit-stock-price-pse"
TICKER_LINK_RE = re.compile(r"https://filgit\.com/([a-z0-9]+)-stock-price-pse", re.IGNORECASE)
PRICE_RE = re.compile(r"\u20b1\s*([\d,]+\.?\d*)")


def scrape_page(page: int, timeout: int = 15) -> dict:
    """Scrapes one page of filgit.com's PSE stock listing. Returns
    {TICKER: {'price': float}} for every row found on that page.

    Price extraction: the FIRST peso-prefixed number in a row is always
    the Stock Price column (Traded Amount, Market Cap, 52-week high/low
    all come later in the row) - confirmed against every row in a fetched
    snapshot of pages 1 and 3, including edge cases like ICT (₱913.00,
    followed by a ₱613.03 Million traded amount) and preferred shares with
    tiny market caps (₱101.80, followed by ₱102 in raw millions).
    """
    url = BASE_URL.format(page=page)
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = {}
    for link in soup.find_all("a", href=True):
        m = TICKER_LINK_RE.search(link["href"])
        if not m:
            continue
        ticker = m.group(1).upper()
        row = link.find_parent("tr")
        if row is None:
            continue
        row_text = row.get_text(" ", strip=True)
        price_match = PRICE_RE.search(row_text)
        if price_match and ticker not in results:
            results[ticker] = {"price": float(price_match.group(1).replace(",", ""))}

    return results


def get_all_pages(pages: list[int] = [1, 2, 3], delay_seconds: float = 1.5) -> dict:
    """Scrapes the given listing pages and merges them into one
    ticker -> {'price': ...} dict covering the full PSE universe.
    Confirmed via fetched snapshot: page 1 ends at row 120, page 3 ends
    at row 315 - so pages 1-3 do cover the whole exchange, not just a
    partial slice."""
    merged = {}
    for page in pages:
        try:
            page_results = scrape_page(page)
            print(f"[scrape_filgit] page {page}: {len(page_results)} tickers")
            merged.update(page_results)
        except Exception as e:
            print(f"[scrape_filgit] page {page} failed: {e}")
        time.sleep(delay_seconds)
    return merged


if __name__ == "__main__":
    all_prices = get_all_pages()
    print(f"\nScraped {len(all_prices)} tickers total across pages 1-3")
    # Sanity check against real holdings
    for t in ["AREIT", "MREIT", "FILRT", "DMC", "RFM"]:
        print(t, all_prices.get(t, "NOT FOUND"))
