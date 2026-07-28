// core/askAiPrompts.ts
// Builds the text shown in AskAiModal - a prompt the person copies and
// pastes into their AI chat of choice. Deliberately built ONLY from fields
// this app actually has (see WatchlistItem/PriceCache/CompanyDetails) -
// no invented conviction scores or signal grids. Where a data point is
// simply absent for a ticker (common for CompanyDetails - it's filled in
// per-ticker, incrementally), the prompt says so explicitly rather than
// silently omitting the row, so the reader - and the AI - both know the
// gap is a data gap, not a "nothing going on" signal.

import { WatchlistItem } from './storeApi';
import { PriceCache, PriceEntry } from './priceCache';
import { CompanyDetails } from './companyDetailsCache';
import { APP_NAME } from './branding';

export const DATA_DISCLAIMER_SHORT =
  'Data sourced from PSE EDGE public reports. Not affiliated with PSE. Not financial advice.';

function fmtPrice(n: number | null | undefined): string {
  return n != null ? `₱${n}` : 'N/A';
}

function fmtPct(n: number | null | undefined): string {
  return n != null ? `${n}%` : 'N/A';
}

function fmtNum(n: number | null | undefined): string {
  return n != null ? n.toLocaleString() : 'N/A';
}

// ---------------------------------------------------------------------
// Watchlist review - built entirely from WatchlistItem[] + PriceCache,
// both already loaded on WatchListScreen, so this never triggers its own
// network call.
// ---------------------------------------------------------------------
export function buildWatchlistPrompt(items: WatchlistItem[], priceCache: PriceCache | null): string {
  const rows = items.map((item) => {
    const entry = priceCache?.tickers[item.ticker] ?? null;
    const price = entry?.price ?? null;
    const yieldPct = entry?.yieldPct ?? null;
    const target = item.buyBelowPrice;
    const withinRange = target != null && price != null && price <= target;

    const bits = [
      `Price: ${fmtPrice(price)}`,
      `Yield: ${yieldPct != null ? fmtPct(yieldPct) : 'N/A (or no dividend)'}`,
      target != null
        ? `Buy-below target: ${fmtPrice(target)}${withinRange ? ' — AT/BELOW TARGET' : ''}`
        : 'Buy-below target: not set',
    ];
    return `- ${item.ticker} — ${bits.join(' | ')}`;
  });

  return `Here is my stock watchlist from ${APP_NAME}, a personal PSE portfolio tracker.
This is raw price data only — no conviction scores or buy/sell signals are
attached to any entry, so please don't invent any. Treat "buy-below
target" as a price I chose myself, not a system-generated signal.

=== WATCHLIST (${items.length} ticker${items.length === 1 ? '' : 's'}) ===
${rows.join('\n')}

=== INSTRUCTIONS ===
1. Search for recent news (past 30 days) on each ticker.
2. For each stock, summarize anything material right now — earnings,
   insider activity, regulatory news, notable price moves.
3. Call out which tickers are currently at or below their buy-below
   target, and flag any with no target set yet.
4. Keep it factual, and say plainly where information is unclear or
   unavailable rather than filling gaps with assumptions.
5. This data is from ${APP_NAME} — factual, not a recommendation. Any
   analysis or interpretation below is yours, not ${APP_NAME}'s.`;
}

// ---------------------------------------------------------------------
// Single-stock valuation - built from CompanyDetails (per-ticker file,
// may be null if that ticker hasn't been backfilled yet), the shared
// PriceEntry, and optionally the person's own position in this stock
// (real data already on StockDetailScreen, genuinely useful context for
// a valuation ask, not fabricated).
// ---------------------------------------------------------------------
export interface StockPositionSummary {
  qty: number;
  avgCost: number;
  marketValue: number | null;
  unrealizedGainPct: number | null;
  totalDividends: number;
  bucketCount: number;
}

export function buildStockDetailPrompt(opts: {
  ticker: string;
  priceEntry: PriceEntry | null;
  details: CompanyDetails | null;
  position?: StockPositionSummary | null;
  buyBelowTarget?: number | null;
}): string {
  const { ticker, priceEntry, details, position, buyBelowTarget } = opts;
  const company = details?.company;
  const ratios = details?.ratios;

  const snapshot = [
    `Ticker: ${ticker}`,
    `Company: ${company?.company_name ?? 'N/A'}`,
    `Sector: ${company?.sector ?? 'N/A'}${company?.pse_subsector ? ` (${company.pse_subsector})` : ''}`,
    `Last Close: ${fmtPrice(company?.last_close ?? priceEntry?.price ?? null)}`,
    `Market Cap: ${company?.market_cap != null ? `₱${(company.market_cap / 1e9).toFixed(1)}B` : 'N/A'}`,
    `52-Week Range: ${fmtPrice(company?.low_52w)} — ${fmtPrice(company?.high_52w)}`,
    `Free Float: ${fmtPct(company?.free_float_pct)}`,
    `Dividend Yield: ${priceEntry?.yieldPct != null ? fmtPct(priceEntry.yieldPct) : 'N/A (or no dividend)'}`,
  ].join('\n');

  const ratiosBlock = ratios
    ? [
        `P/E: ${ratios.pe != null ? `${ratios.pe}x` : 'N/A'}`,
        `P/BV: ${ratios.pbv != null ? `${ratios.pbv}x` : 'N/A'}`,
        `ROE: ${fmtPct(ratios.roe)}`,
        `Net Margin: ${fmtPct(ratios.netMargin)}`,
      ].join('\n')
    : 'No fundamentals published yet for this ticker in Ani — do not estimate these.';

  const foreignFlow = details?.net_foreign_30d != null
    ? `Net Foreign Flow (30d): ₱${details.net_foreign_30d.toLocaleString()}`
    : 'Net Foreign Flow (30d): N/A';

  const dividendLines = details?.dividends?.length
    ? details.dividends.slice(0, 5).map((d) => `- ${d.exDate}: ${d.amount}${d.isPreferred ? ' (preferred)' : ''}`).join('\n')
    : 'No dividend history published yet for this ticker in Ani.';

  const holderLines = details?.top_holders?.length
    ? details.top_holders.slice(0, 5).map((h) => `- ${h.name}: ${fmtNum(h.total_shares)} shares (${fmtPct(h.pct_outstanding)})`).join('\n')
    : 'No ownership breakdown published yet for this ticker in Ani.';

  const insiderNote = Array.isArray(details?.insiders) && details!.insiders.length > 0
    ? 'Insider transaction data is available in Ani for this ticker but not summarized in this prompt — ask me to pull it if you want it included.'
    : 'No insider transaction data published yet for this ticker in Ani.';

  const buybackNote = Array.isArray(details?.buybacks) && details!.buybacks.length > 0
    ? 'Buyback activity is on file in Ani for this ticker — ask me to pull it if you want it included.'
    : 'No share buybacks on file for this ticker in Ani.';

  const positionBlock = position && position.qty > 0
    ? [
        `Shares Held: ${fmtNum(position.qty)} across ${position.bucketCount} bucket${position.bucketCount === 1 ? '' : 's'}`,
        `Average Cost: ${fmtPrice(position.avgCost)}`,
        `Market Value: ${fmtPrice(position.marketValue)}`,
        `Unrealized Gain: ${position.unrealizedGainPct != null ? `${position.unrealizedGainPct >= 0 ? '+' : ''}${position.unrealizedGainPct}%` : 'N/A'}`,
        `Dividends Received: ₱${position.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      ].join('\n')
    : 'Not currently held in any bucket.';

  return `You are a senior equities analyst. Produce a valuation analysis for
this Philippine stock, using the data below from ${APP_NAME} — supplement
with your own research where noted.

=== STOCK SNAPSHOT ===
${snapshot}

=== VALUATION RATIOS ===
${ratiosBlock}

=== FOREIGN INSTITUTIONAL FLOW ===
${foreignFlow}

=== RECENT DIVIDENDS ===
${dividendLines}

=== TOP HOLDERS ===
${holderLines}

=== INSIDER ACTIVITY ===
${insiderNote}

=== SHARE BUYBACKS ===
${buybackNote}

=== MY POSITION (${APP_NAME}) ===
${positionBlock}
${buyBelowTarget != null ? `My buy-below target: ${fmtPrice(buyBelowTarget)}` : 'No buy-below target set.'}

=== INSTRUCTIONS ===
1. Search for recent news about ${ticker} from the past 30 days.
2. FAIR VALUE ESTIMATE — derive from available multiples with explicit
   methodology and math. If ratios are marked N/A above, say so instead
   of estimating from nothing.
3. KEY ANALYSIS — earnings quality, foreign flow direction (accumulation
   or distribution?), and any red flags, each with specific numbers.
4. PEER COMPARISON — name 3-5 PSE-listed peers in the same sector and
   compare P/E, P/BV, ROE if you can find that data.
5. EVENTS TO MONITOR — with rough timeframes.
6. KEY RISKS — quantified where possible.
7. EVIDENCE SUMMARY: SUPPORTED | MIXED | WEAK | DATA INSUFFICIENT.

Use only the actual numbers given above or found via search — write "N/A"
rather than fabricating a figure. This data is from ${APP_NAME} — factual,
not a recommendation. Your analysis below is your own interpretation.`;
}
