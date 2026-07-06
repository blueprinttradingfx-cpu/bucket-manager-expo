// core/stockUniverse.ts
// Powers "search stock": the full list of tickers the price-scraper
// pipeline knows about, not just the ones you currently hold. Same
// GitHub repo as the price cache itself, so it's reused via
// normalizeGithubUrl (the blob URL you'd copy from GitHub's file viewer
// gets auto-corrected to the raw content URL, same fix as priceCache.ts).

import { normalizeGithubUrl } from './priceCache';

const DEFAULT_TICKERS_URL =
  'https://raw.githubusercontent.com/blueprinttradingfx-cpu/bucket-manager-web/refs/heads/master/price-scraper/scripts/tickers.json';

let cached: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes - this list changes rarely, no need to refetch every search keystroke

export async function fetchStockUniverse(url: string = DEFAULT_TICKERS_URL, opts: { force?: boolean } = {}): Promise<string[]> {
  if (!opts.force && cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const fetchUrl = normalizeGithubUrl(url);
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch stock universe: HTTP ${res.status} from ${fetchUrl}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.every((t) => typeof t === 'string')) {
    throw new Error('Stock universe response was not a JSON array of ticker strings');
  }

  cached = data;
  cachedAt = Date.now();
  return data;
}
