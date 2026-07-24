// core/watchlistImport.ts
// Shared merge rule for bringing external ticker + buy-below-price lists
// (the shared "portfolios" in core/portfolioCatalog.ts) into the user's own
// watchlist. Kept separate from storeApi so both platform stores
// (db.native.ts, db.web.ts) and the catalog/UI layer apply the exact same
// rule instead of each reimplementing it slightly differently.

export interface PortfolioStockInput {
  ticker: string;
  buyBelowPrice: number | null;
}

/** Two buy-below prices for the same ticker collide - either across two
 *  portfolios imported together, or between an incoming import and a price
 *  already on the watchlist - the LOWER one wins. A lower buy-below price
 *  is the stricter, more conservative entry target, so merging never
 *  loosens a target the user (or an earlier import) already set. A price
 *  that's actually set always beats "no price," rather than being cleared
 *  by it. */
export function mergeBuyBelowPrice(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/** Collapses a combined stock list (e.g. several portfolios selected for
 *  import in one go) down to one row per ticker, applying
 *  mergeBuyBelowPrice to any duplicates. Tickers are trimmed/uppercased so
 *  "areit" and "AREIT" from two different sources are treated as the same
 *  stock. Order of the input doesn't matter - the result is sorted by
 *  ticker for stable, predictable previews. */
export function dedupePortfolioStocks(stocks: PortfolioStockInput[]): PortfolioStockInput[] {
  const byTicker = new Map<string, number | null>();
  for (const s of stocks) {
    const ticker = s.ticker.trim().toUpperCase();
    if (!ticker) continue;
    byTicker.set(ticker, byTicker.has(ticker) ? mergeBuyBelowPrice(byTicker.get(ticker)!, s.buyBelowPrice) : s.buyBelowPrice);
  }
  return Array.from(byTicker.entries())
    .map(([ticker, buyBelowPrice]) => ({ ticker, buyBelowPrice }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}
