// core/marketPulseCache.ts
// Fetches the two market-wide JSON feeds behind the Market Pulse screen.
// These are genuinely TWO different upstream sources, not one dataset:
//   - market-pulse.json (dragonfi source): PSEi snapshot, RSI, sentiment,
//     market movers, most-active, 52-week lists.
//   - the dividends/macro file (MarketShack source): tickers with
//     upcoming ex-dividend dates, plus a macro events calendar. A
//     genuinely separate list from marketMovers/mostActive above - not
//     portfolio-scoped, just "what's coming up market-wide."
// Same single-shared-file pattern as priceCache.ts (not per-ticker like
// companyDetailsCache.ts, since each is one global snapshot) - but the
// null-on-failure posture of companyDetailsCache.ts: network/404/malformed
// JSON all resolve to `null`, never throw. Market Pulse is supplementary
// context on Dashboard, not core portfolio data, so a missing or broken
// feed should never block or crash the rest of the screen.

import { DATA_PROXY_BASE_URL } from './priceCache';

export interface PseiSnapshot {
  price: number;
  changePrice: number;
  changePercent: number;
  prevClose: number;
  ytdReturnPercent: number;
  volume: number;
  turnover: number;
  volumeAll: number;
  turnoverAll: number;
}

export interface RsiReading {
  tradeDate: string;
  price: number;
  value: number;
}

// `bbr` = Bull/Bear Ratio, a 0-100 sentiment reading (>50 skews bullish,
// <50 bearish) - that's the standard convention for this term, not a
// confirmed DragonFi-specific definition. Their market-pulse page is a
// client-rendered SPA, so it couldn't be scraped for their exact wording -
// worth a screenshot from the live app if the UI copy needs to match
// DragonFi's own label precisely.
export interface MarketSentiment {
  bbr: number;
}

export interface MoverStock {
  symbol: string;
  name: string;
  price: number;
  changePrice: number;
  changePercent: number;
  // DragonFi's own logo CDN path - intentionally unused. This app renders
  // every ticker logo via TickerLogo.tsx (its own public/logos/{TICKER}.png
  // pipeline) for one consistent look across screens. Kept in the type
  // only for parity with the source JSON, not because the UI reads it.
  logoPath: string;
}

// Shared by mostActive.byValue and .byVolume. The two lists are mutually
// exclusive on which stat they carry - confirmed against the real
// generated file, not assumed: byValue's `volume` is always null,
// byVolume's `turnover` is always null.
export interface MostActiveStock {
  symbol: string;
  name: string;
  price: number;
  changePrice: number;
  changePercent: number;
  turnover: number | null;
  volume: number | null;
  logoPath: string; // see MoverStock's comment - unused, TickerLogo covers this
}

// Shared by near52Week*/crossed52Week*. Confirmed against the real file:
// crossed lists always carry week52Percent: null, near lists always have
// it populated. One nullable field, rather than two silently-diverging
// types for what's really the same shape.
export interface WeekRangeStock {
  symbol: string;
  price: number;
  week52: number;
  week52Percent: number | null;
  logoPath: string; // unused, see MoverStock's comment
}

export interface MarketPulseData {
  marketPulse: {
    psei: PseiSnapshot;
    rsi: RsiReading;
    marketSentiment: MarketSentiment;
  };
  marketMovers: {
    isMarketOpen: boolean;
    lastTradeTime: string;
    topGainers: MoverStock[];
    topLosers: MoverStock[];
  };
  mostActive: {
    byValue: MostActiveStock[];
    byVolume: MostActiveStock[];
  };
  near52WeekHigh: WeekRangeStock[];
  near52WeekLow: WeekRangeStock[];
  crossed52WeekHigh: WeekRangeStock[];
  crossed52WeekLow: WeekRangeStock[];
  // Empty in every generated file seen so far. Not a bug to work around -
  // MarketPulseScreen just hides this section when empty, same as every
  // other optional section here.
  keyEconomicIndicators: unknown[];
  generatedAt: string;
  errors: Record<string, string>;
  source: string;
}

export interface DividendCalendarEntry {
  ticker: string;
  amount: string; // pre-formatted with the peso sign, e.g. "₱1.10" - same convention as companyDetailsCache.ts's DividendRecord.amount
  exDate: string;
}

export interface MacroEvent {
  date: string;
  label: string;
  market: string;
  type: string;
}

export interface DividendsMacroData {
  _generated_at: string;
  dividends: DividendCalendarEntry[];
  macro: MacroEvent[];
}

// Same repo as prices.json/company-details - served through the Worker
// proxy, see priceCache.ts's DATA_PROXY_BASE_URL comment.
export const DEFAULT_MARKET_PULSE_URL = `${DATA_PROXY_BASE_URL}/v1/market-pulse`;

// UNCONFIRMED - best guess following market-pulse.json's naming
// convention (kebab-case, public/data/). This is a genuinely different
// upstream source from market-pulse.json (MarketShack scrape vs
// dragonfi), so it may not even live in the same folder. Confirm the
// real hosted path and fix this constant before relying on the
// dividends/macro section of Market Pulse - until then this will just
// 404 and DividendsMacroCard/section will render its normal "not
// available" empty state, not crash anything.
// Worker route is wired up and ready (/v1/dividends-macro) - only this
// constant and the Worker's route map need to agree on the real
// public/data/ filename once the UNCONFIRMED path above is verified.
export const DEFAULT_DIVIDENDS_MACRO_URL = `${DATA_PROXY_BASE_URL}/v1/dividends-macro`;

interface CacheEntry<T> {
  data: T | null;
  at: number;
}

// 1hr memory TTL, same reasoning as priceCache.ts/companyDetailsCache.ts:
// upstream refreshes once/day (after market close), so re-fetching within
// the same day just re-downloads the same snapshot. Two independent slots
// since these are two independent upstream files with unrelated failure
// modes - one being down shouldn't evict the other's cache.
const MEMORY_TTL_MS = 60 * 60 * 1000;
let pulseCache: CacheEntry<MarketPulseData> = { data: null, at: 0 };
let divMacroCache: CacheEntry<DividendsMacroData> = { data: null, at: 0 };

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    // Offline, DNS failure, CORS, etc. Don't cache this outcome - worth
    // retrying next time the screen opens rather than sticking for an hour.
    console.log(`[marketPulseCache] network error fetching ${label}:`, e?.message ?? String(e));
    return null;
  }
  if (!res.ok) {
    console.log(`[marketPulseCache] HTTP ${res.status} fetching ${label}`);
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch (e: any) {
    console.log(`[marketPulseCache] malformed JSON fetching ${label}:`, e?.message ?? String(e));
    return null;
  }
}

export async function fetchMarketPulse(
  url: string = DEFAULT_MARKET_PULSE_URL,
  opts: { force?: boolean } = {}
): Promise<MarketPulseData | null> {
  if (!opts.force && pulseCache.data && Date.now() - pulseCache.at < MEMORY_TTL_MS) {
    return pulseCache.data;
  }
  const data = await fetchJson<MarketPulseData>(url, 'market-pulse');
  pulseCache = { data, at: Date.now() };
  return data;
}

export async function fetchDividendsMacroCalendar(
  url: string = DEFAULT_DIVIDENDS_MACRO_URL,
  opts: { force?: boolean } = {}
): Promise<DividendsMacroData | null> {
  if (!opts.force && divMacroCache.data && Date.now() - divMacroCache.at < MEMORY_TTL_MS) {
    return divMacroCache.data;
  }
  const data = await fetchJson<DividendsMacroData>(url, 'dividends-macro calendar');
  divMacroCache = { data, at: Date.now() };
  return data;
}

// 30h rather than priceCache's 48h - this feed refreshes strictly once a
// day (after close), so 30h still gives a buffer past the next close
// without letting a genuinely broken pipeline go unnoticed for two days.
export function isMarketPulseStale(data: MarketPulseData, maxAgeHours = 30): boolean {
  const ageMs = Date.now() - new Date(data.generatedAt).getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}
