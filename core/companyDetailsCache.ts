// core/companyDetailsCache.ts
// Fetches the per-ticker "deep dive" company profile JSON produced for the
// bucket-manager-web project - public/data/company-details/{TICKER}.json.
// Sibling data source to priceCache.ts/fundCache.ts, but ONE FILE PER
// TICKER rather than one shared file, since this dataset (OHLCV history,
// foreign flow, top holders, broker inventory, dividend history...) is far
// heavier per-symbol and is being backfilled incrementally rather than all
// at once.
//
// IMPORTANT: not every ticker has a file yet. A missing file (HTTP 404) is
// a NORMAL, expected state here - not an error - so this resolves to
// `null` instead of throwing, unlike fetchPriceCache/fetchFundCache which
// throw on a bad response. That's a deliberate difference: those two are a
// single shared file that should always exist, so a bad response there IS
// exceptional. Genuine network failures and malformed JSON also resolve to
// `null` (logged, not thrown) for the same reason - this is supplementary
// detail for StockDetailScreen, not core data the rest of the screen
// depends on, so callers should be able to render a plain "not available"
// state without wrapping every call site in try/catch.

import { DATA_PROXY_BASE_URL } from './priceCache';

export interface CompanyInfo {
  id: number;
  cmpy_id: number;
  ticker: string;
  company_name: string;
  sector: string | null;
  market_cap: number | null;
  outstanding_shares: number | null;
  last_close: number | null;
  free_float_pct: number | null;
  high_52w: number | null;
  low_52w: number | null;
  pe_ratio: number | null;
  updated_at: string | null;
  description: string | null;
  isin: string | null;
  listing_date: string | null;
  par_value: number | null;
  board_lot: number | null;
  foreign_limit_pct: number | null;
  incorporation_date: string | null;
  fiscal_year: string | null;
  external_auditor: string | null;
  pse_subsector: string | null;
}

export interface CompanyRatios {
  pe: number | null;
  pbv: number | null;
  roe: number | null;
  netMargin: number | null;
  qualityFlags?: Record<string, unknown>;
}

export interface ForeignFlowDay {
  id: number;
  ticker: string;
  trade_date: string;
  net_foreign: number;
  volume: number;
  value: number;
  close_price: number;
}

export interface ForeignFlowHistoryPoint {
  trade_date: string;
  net_total: number;
}

export interface DividendRecord {
  date: string;
  amount: string; // pre-formatted with the peso sign, e.g. "₱0.58"
  exDate: string;
  recordDate: string;
  paymentDate: string;
  isPreferred: boolean;
}

export interface TopHolder {
  section: string;
  name: string;
  direct_shares: number;
  indirect_shares: number;
  total_shares: number;
  pct_outstanding: number;
}

export interface OwnershipChange {
  name: string;
  section: string;
  current_shares: number;
  current_pct: number;
  previous_shares: number;
  previous_pct: number;
  change_shares: number;
  // Almost always a number, but the source data has a handful of "$-0"
  // string values for zero-ish changes - treat defensively at render time
  // rather than trusting the type.
  change_pct: number | string;
  status: 'persistent' | 'disappeared' | string;
}

export interface BrokerInventoryChange {
  ticker: string;
  broker_name: string;
  latest_date: string;
  earliest_date: string;
  latest_shares: number;
  earliest_shares: number;
  change_shares: number;
  change_pct: number;
}

export interface OhlcvBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CompanyDetails {
  company: CompanyInfo;
  ratios: CompanyRatios;
  last_close: number | null;
  last_trade_date: string | null;
  dividend_yield: number | null;
  foreign_flow_30d: ForeignFlowDay[];
  net_foreign_30d: number | null;
  foreign_flow_full_history: ForeignFlowHistoryPoint[];
  insiders: unknown[];
  dividends: DividendRecord[];
  buybacks: unknown[];
  float_shares: number | null;
  top_holders: TopHolder[];
  ownership_changes: OwnershipChange[];
  broker_inventory_changes: BrokerInventoryChange[];
  ohlcv: OhlcvBar[];
}

// Ticker is templated onto the end - {baseUrl}/{TICKER}.json. Same repo as
// DEFAULT_PRICE_CACHE_URL/DEFAULT_FUND_CACHE_URL, sibling folder under
// public/data/, served through the Worker proxy.
export const DEFAULT_COMPANY_DETAILS_BASE_URL = `${DATA_PROXY_BASE_URL}/v1/companies`;

interface CacheEntry {
  data: CompanyDetails | null;
  at: number;
}

// Keyed by ticker (unlike priceCache/fundCache's single-value cache) since
// this is one file per symbol. Caches the "not found" result too, so
// re-opening the same ticker's detail screen within the TTL doesn't refire
// a 404 every time.
const memoryCache = new Map<string, CacheEntry>();
const MEMORY_TTL_MS = 60 * 60 * 1000; // matches priceCache/fundCache's TTL reasoning - upstream refreshes at most once/day

export async function fetchCompanyDetails(
  ticker: string,
  baseUrl: string = DEFAULT_COMPANY_DETAILS_BASE_URL,
  opts: { force?: boolean } = {}
): Promise<CompanyDetails | null> {
  const cached = memoryCache.get(ticker);
  if (!opts.force && cached && Date.now() - cached.at < MEMORY_TTL_MS) {
    return cached.data;
  }

  const url = `${baseUrl}/${encodeURIComponent(ticker)}.json`;
  console.log('[companyDetailsCache] fetching', url);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    // Offline, DNS failure, CORS, etc. Don't cache this outcome - worth
    // retrying next time the screen opens rather than sticking for an hour.
    console.log('[companyDetailsCache] network error fetching', ticker, '-', e?.message ?? String(e));
    return null;
  }

  if (res.status === 404) {
    // The catch this ticket asked for: most tickers don't have a
    // company-details file published yet (this dataset is being filled in
    // incrementally, one ticker at a time). That's expected, not a bug.
    console.log('[companyDetailsCache] no company-details file published yet for', ticker);
    memoryCache.set(ticker, { data: null, at: Date.now() });
    return null;
  }
  if (!res.ok) {
    console.log('[companyDetailsCache] HTTP', res.status, 'fetching company details for', ticker);
    return null;
  }

  try {
    const data = (await res.json()) as CompanyDetails;
    memoryCache.set(ticker, { data, at: Date.now() });
    return data;
  } catch (e: any) {
    console.log('[companyDetailsCache] malformed JSON for', ticker, '-', e?.message ?? String(e));
    return null;
  }
}
