// core/portfolioCatalog.ts
// Catalog of shared, pre-built "portfolios" - static ticker + buy-below-price
// lists dropped into /portfolios (repo root, alongside core/ and screens/)
// as plain JSON, e.g. copied from a forum post or a friend's watch list.
// Powers the "Import Portfolio" flow on the Watch List screen: the user
// copies someone else's list of tickers (and target prices) into their own
// watchlist instead of re-typing every ticker by hand.
//
// HOW TO ADD A NEW PORTFOLIO:
//   1. Drop a JSON file into /portfolios, shaped like the existing ones:
//      [{ "STOCK": "AREIT", "BUY BELOW PRICE": "₱39.50" }, ...]
//   2. Add one `import` line and one PORTFOLIO_FILES entry below.
// Metro (the RN/Expo bundler) needs each JSON file statically imported by
// name - it can't scan the folder at runtime - so this file is the one
// place that has to be touched by hand when a portfolio is added.

import dividendHarvest from '../portfolios/Dividend_Harvest_Portfolio.json';
import dragonFiBenchmark from '../portfolios/DragonFi_Dividend_Benchmark__D15.json';
import investingPH from '../portfolios/InvestingPH_s_Portfolio.json';
import kuyaJon from '../portfolios/Kuya_Jon_s_Portfolio.json';
import moneyWiseEngineer from '../portfolios/MoneyWise_Engineer_s_Portfolio.json';
import reitBuddy from '../portfolios/Reit_Buddy_s_Portfolio.json';
import stocksilog from '../portfolios/Stocksilog_s_Portfolio.json';
import strategicGrowth from '../portfolios/Strategic_Growth_Portfolio.json';
import trinaSnowball from '../portfolios/Trina_s_Snowball_Picks.json';
import eTrader from '../portfolios/eTrader_s_Portfolio.json';
import { dedupePortfolioStocks, PortfolioStockInput } from './watchlistImport';

interface RawPortfolioRow {
  STOCK: string;
  'BUY BELOW PRICE': string;
}

export interface Portfolio {
  /** Stable key - the source filename minus extension. */
  id: string;
  /** Human-readable name, derived from the filename (see toDisplayName). */
  name: string;
  stocks: PortfolioStockInput[];
}

const PORTFOLIO_FILES: { id: string; rows: RawPortfolioRow[] }[] = [
  { id: 'Dividend_Harvest_Portfolio', rows: dividendHarvest as RawPortfolioRow[] },
  { id: 'DragonFi_Dividend_Benchmark__D15', rows: dragonFiBenchmark as RawPortfolioRow[] },
  { id: 'InvestingPH_s_Portfolio', rows: investingPH as RawPortfolioRow[] },
  { id: 'Kuya_Jon_s_Portfolio', rows: kuyaJon as RawPortfolioRow[] },
  { id: 'MoneyWise_Engineer_s_Portfolio', rows: moneyWiseEngineer as RawPortfolioRow[] },
  { id: 'Reit_Buddy_s_Portfolio', rows: reitBuddy as RawPortfolioRow[] },
  { id: 'Stocksilog_s_Portfolio', rows: stocksilog as RawPortfolioRow[] },
  { id: 'Strategic_Growth_Portfolio', rows: strategicGrowth as RawPortfolioRow[] },
  { id: 'Trina_s_Snowball_Picks', rows: trinaSnowball as RawPortfolioRow[] },
  { id: 'eTrader_s_Portfolio', rows: eTrader as RawPortfolioRow[] },
];

/** "Kuya_Jon_s_Portfolio" -> "Kuya Jon's Portfolio". Handles the "_s_"
 *  (possessive) underscore pattern the existing filenames use, then turns
 *  any remaining underscores (single or doubled) into spaces. */
function toDisplayName(id: string): string {
  return id
    .replace(/_s_/g, "'s ")
    .replace(/_s$/, "'s")
    .replace(/_+/g, ' ')
    .trim();
}

/** "₱1,650.00" -> 1650, "₱3.35" -> 3.35. Returns null (rather than
 *  throwing) for anything that doesn't parse to a positive number, since
 *  these files are hand-curated and one stray malformed row shouldn't take
 *  down the whole import - that ticker just imports with no target price. */
function parsePesoPrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[₱,\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const PORTFOLIO_CATALOG: Portfolio[] = PORTFOLIO_FILES
  .map(({ id, rows }) => ({
    id,
    name: toDisplayName(id),
    stocks: dedupePortfolioStocks(
      (rows ?? [])
        .filter((r) => r && r.STOCK && r.STOCK.trim())
        .map((r) => ({ ticker: r.STOCK.trim(), buyBelowPrice: parsePesoPrice(r['BUY BELOW PRICE']) }))
    ),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
