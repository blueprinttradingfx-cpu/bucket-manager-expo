// core/scraper.ts
// Port of scrape_dividends_ph.py. On native (iOS/Android) fetch() is not
// subject to CORS - that restriction only exists inside browsers - so this
// can call dividends.ph directly with zero backend/proxy involved.
//
// Still UNVERIFIED end-to-end (this sandbox can't reach dividends.ph either,
// same restriction as the Python version). Selectors are regex-based over
// rendered text, same approach as the Python version - fragile to markup
// changes by design tradeoff (simplicity over robustness for a personal tool).
// Cache results locally (see CACHE_HOURS) rather than fetching on every load -
// both to be polite to a small unofficial site and because yield doesn't move
// intraday anyway.

export interface PriceYield {
  ticker: string;
  price: number;
  yieldPct: number;
  fetchedAt: string; // ISO timestamp
}

const BASE_URL = 'https://dividends.ph/company/';
export const CACHE_HOURS = 24;

export async function fetchPriceAndYield(ticker: string): Promise<PriceYield> {
  const res = await fetch(BASE_URL + ticker.toUpperCase(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (personal portfolio tool)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${ticker}`);
  const html = await res.text();

  // Strip tags to plain text before regex matching - same approach as the
  // Python BeautifulSoup .get_text() step, minus the dependency.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const priceMatch = /₱\s*([\d,]+\.\d{2})/.exec(text);
  const yieldMatch = /Dividend Yield\s*([\d.]+)\s*%/.exec(text);

  if (!priceMatch || !yieldMatch) {
    throw new Error(`Could not parse price/yield for ${ticker} - page structure may have changed`);
  }

  return {
    ticker: ticker.toUpperCase(),
    price: parseFloat(priceMatch[1].replace(/,/g, '')),
    yieldPct: parseFloat(yieldMatch[1]),
    fetchedAt: new Date().toISOString(),
  };
}

/** Sequential with a delay - polite to the source, matches the Python version's approach. */
export async function fetchMany(
  tickers: string[], delayMs = 1500
): Promise<(PriceYield | { ticker: string; error: string })[]> {
  const out: (PriceYield | { ticker: string; error: string })[] = [];
  for (const t of tickers) {
    try {
      out.push(await fetchPriceAndYield(t));
    } catch (e: any) {
      out.push({ ticker: t.toUpperCase(), error: e.message });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

export function isCacheStale(fetchedAt: string): boolean {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs > CACHE_HOURS * 60 * 60 * 1000;
}
