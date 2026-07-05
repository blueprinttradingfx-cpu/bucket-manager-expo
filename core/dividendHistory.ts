// core/dividendHistory.ts
// Fetches per-ticker real dividend payment history (ex-date, record date,
// payment date, per-share amount) from the bucket-manager-web repo's
// generated dividend-history.json. Used to simulate realistic dividend
// income for MANUALLY entered holdings (see core/dividendSimulation.ts) -
// those otherwise only ever earn dividends if you type each payment in by
// hand, which nobody actually does for years of history.

import { normalizeGithubUrl } from './priceCache';

export interface DividendHistoryEntry {
  amount: number;      // per-share amount
  currency: string;    // e.g. "PHP"
  exDate: string;       // e.g. "Mar 18, 2026" - must hold shares as of this date to qualify
  recordDate: string;
  paymentDate: string;  // when cash actually lands - used as the simulated transaction's date
  status: string;        // "Paid" | "Declared" etc. - only "Paid" entries are used for simulation
}

export interface DividendHistoryCache {
  generatedAt: string;
  tickers: Record<string, { history: DividendHistoryEntry[] }>;
}

const DEFAULT_DIVIDEND_HISTORY_URL =
  'https://github.com/blueprinttradingfx-cpu/bucket-manager-web/blob/master/public/data/dividend-history.json';

let memoryCache: DividendHistoryCache | null = null;
let memoryCacheAt = 0;
const MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour - this data changes rarely (new dividend declarations, not every day)

export async function fetchDividendHistory(
  url: string = DEFAULT_DIVIDEND_HISTORY_URL,
  opts: { force?: boolean } = {}
): Promise<DividendHistoryCache> {
  if (!opts.force && memoryCache && Date.now() - memoryCacheAt < MEMORY_TTL_MS) {
    return memoryCache;
  }
  const fetchUrl = normalizeGithubUrl(url);
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch dividend history: HTTP ${res.status} from ${fetchUrl}`);
  }
  const data = (await res.json()) as DividendHistoryCache;
  memoryCache = data;
  memoryCacheAt = Date.now();
  return data;
}

export function getDividendHistoryForTicker(cache: DividendHistoryCache | null, ticker: string): DividendHistoryEntry[] {
  return cache?.tickers?.[ticker]?.history ?? [];
}
