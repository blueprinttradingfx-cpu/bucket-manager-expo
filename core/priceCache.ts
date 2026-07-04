// core/priceCache.ts
// Fetches the static price/yield JSON produced by the GitHub Actions
// pipeline (scripts/generate_price_cache.py, committed to
// public/data/prices.json - see the separate bucket-manager-web project).
// One implementation for ALL platforms - no .native/.web split needed here,
// because raw.githubusercontent.com serves `Access-Control-Allow-Origin: *`
// (verified directly: `curl -sI` against a real file on that host returned
// exactly that header), so the browser's CORS restriction that forced a
// platform split for xlsx import simply doesn't apply to this fetch.

export interface PriceEntry {
  price: number;
  yieldPct: number;
}

export interface PriceCache {
  generatedAt: string;
  tickers: Record<string, PriceEntry>;
  errors?: Record<string, string>;
}

// PLACEHOLDER - replace with your actual repo once this project is pushed
// to GitHub and the refresh-prices.yml workflow has run at least once:
// https://raw.githubusercontent.com/<your-username>/<your-repo>/main/public/data/prices.json
export const DEFAULT_PRICE_CACHE_URL =
  'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/public/data/prices.json';

let memoryCache: PriceCache | null = null;
let memoryCacheAt = 0;
const MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour - avoid refetching on every screen mount; the underlying data itself only refreshes once/day anyway

export async function fetchPriceCache(
  url: string = DEFAULT_PRICE_CACHE_URL,
  opts: { force?: boolean } = {}
): Promise<PriceCache> {
  if (!opts.force && memoryCache && Date.now() - memoryCacheAt < MEMORY_TTL_MS) {
    return memoryCache;
  }
  console.log('[priceCache] fetching', url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch price cache: HTTP ${res.status} from ${url}`);
  }
  const data = (await res.json()) as PriceCache;
  console.log('[priceCache] loaded', Object.keys(data.tickers ?? {}).length, 'tickers, generated', data.generatedAt);
  memoryCache = data;
  memoryCacheAt = Date.now();
  return data;
}

export function getPrice(cache: PriceCache | null, ticker: string): PriceEntry | null {
  return cache?.tickers?.[ticker] ?? null;
}

export function isStale(cache: PriceCache, maxAgeHours = 48): boolean {
  const ageMs = Date.now() - new Date(cache.generatedAt).getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}
