// core/bucketLogic.ts
// Pure, storage-agnostic logic ported from bucket_store.py / parse_dragonfi.py.
// No SQLite, no Expo, no React - just data in, data out. This is what gets
// unit-tested directly in Node, then wired into expo-sqlite separately in
// core/db.ts. Keeping this pure is what let us test it without a device.

export type TxnType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT' | 'CASH DIVIDEND';

export interface RawRow {
  Date: string;           // as read from xlsx, e.g. "30/01/2026" (DD/MM/YYYY)
  Type: TxnType;
  Stock: string | null;
  Description: string | null;
  Quantity: number | null;
  Price: number | null;
  'Comm & Other Fees': number | null;
  Currency: string | null;
  Amount: number | null;
}

export interface StoredTxn extends RawRow {
  rowHash: string;
  isoDate: string;        // normalized YYYY-MM-DD for sorting
}

export interface Holding {
  ticker: string;
  openLots: number;
  totalQty: number;
  avgCost: number;
  totalCostBasis: number;
  /** True when this ticker has money committed (BUY rows with an Amount)
   *  but the statement hasn't given us Quantity/Price yet - typical of
   *  feeder-fund lump-sum buys, where DragonFi doesn't back-fill units/NAVPU
   *  into the export until the fund settles a few days later. totalQty is 0
   *  and avgCost is 0 in this state, but totalCostBasis reflects the real
   *  peso amount invested so it isn't silently dropped from any total. */
  pendingSettlement?: boolean;
}

export interface DividendEntry { ticker: string; date: string; amount: number; }

/** A fund BUY row (imported or manual), classified by a "fund" match in
 *  its Description. Quantity/Price are null while still unsettled (see
 *  Holding.pendingSettlement) and populated once known - either way this
 *  is what's surfaced on the Import screen's "Fund Prices Needed" list,
 *  so a value can be filled in OR corrected later if it was wrong. */
export interface FundFill {
  id: number;
  date: string;
  stock: string;
  description: string | null;
  amount: number;
  quantity: number | null;
  price: number | null;
}

/** One closed (or partially closed) sale, matched against the FIFO lot(s) it
 *  consumed. This is what lets a fully-exited position still contribute a
 *  gain/loss number after it drops out of current holdings - without this,
 *  selling a stock at a profit or loss simply vanished from every summary. */
export interface RealizedTrade {
  ticker: string;
  sellDate: string;
  quantity: number;      // shares actually matched against a prior lot (excludes any orphaned portion)
  sellPrice: number;
  costBasis: number;     // FIFO cost basis of the matched shares
  proceeds: number;      // matched shares * sell price, minus this sale's fees
  realizedGain: number;  // proceeds - costBasis
}

/** Coarse instrument classification, used to split the dashboard into
 *  Stocks | Funds tabs. Derived from the xlsx "Description" column rather
 *  than a hardcoded ticker list, since new feeder funds can show up in any
 *  future statement import. REITs (e.g. AREIT, CREIT) trade on the PSE like
 *  ordinary equities, so they're classified as stocks, not funds. */
export type AssetType = 'stock' | 'fund';

export function classifyAssetType(description: string | null | undefined): AssetType {
  return description && /fund/i.test(description) ? 'fund' : 'stock';
}

/** Builds a ticker -> description lookup from a batch of transactions, used
 *  to classify asset type. Picks the first non-null description seen per
 *  ticker (in practice this is stable per-ticker across rows). */
function buildDescriptionsByTicker(txns: StoredTxn[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const t of txns) {
    if (t.Stock && out[t.Stock] == null && t.Description) out[t.Stock] = t.Description;
  }
  return out;
}

/** Pulls CASH DIVIDEND rows out of a bucket's transaction history. */
export function computeDividends(txns: StoredTxn[]): DividendEntry[] {
  return txns
    .filter((t) => t.Type === 'CASH DIVIDEND' && t.Stock != null)
    .map((t) => ({ ticker: t.Stock!, date: t.isoDate, amount: t.Amount ?? 0 }));
}

function sumDividendsByTicker(entries: DividendEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.ticker] = round((out[e.ticker] ?? 0) + e.amount, 2);
  return out;
}

/** One ticker, within one specific bucket - holdings + dividends earned while held there. */
export interface BucketStockPosition {
  bucket: string;
  ticker: string;
  openLots: number;
  totalQty: number;
  avgCost: number;
  totalCostBasis: number;
  totalDividends: number;
  realizedGain: number;
  assetType: AssetType;
  /** See Holding.pendingSettlement - carried through from FIFO computation. */
  pendingSettlement?: boolean;
}

function sumRealizedGainByTicker(trades: RealizedTrade[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of trades) out[t.ticker] = round((out[t.ticker] ?? 0) + t.realizedGain, 2);
  return out;
}

/** Combines FIFO holdings + dividend totals + realized gains for a single
 *  bucket's full transaction history. `realizedTrades` covers every closed
 *  sale, including tickers that are now fully exited and so no longer have
 *  an entry in `positions` - callers that want a per-ticker realized figure
 *  even for closed-out tickers should use `realizedGainByTicker`, not the
 *  `realizedGain` field on `positions` (which is 0 for a ticker with no
 *  current holding, since it stopped appearing in `positions` at that point). */
export function computeBucketPositions(
  bucketName: string, allTxns: StoredTxn[]
): {
  positions: BucketStockPosition[];
  /** Tickers that were transacted in this bucket at some point but have
   *  since been fully sold down to zero shares here - openLots/totalQty/
   *  avgCost/totalCostBasis are all 0, but totalDividends and realizedGain
   *  are preserved so the bucket's history for that ticker isn't lost.
   *  Kept separate from `positions` (current holdings) so existing
   *  consumers of `positions` - the per-bucket holdings list, portfolio
   *  totals, etc. - don't suddenly start seeing zero-share rows. Callers
   *  that want "every bucket ever holding this ticker" (e.g. the stock
   *  detail screen's "Held In" list) should combine `positions` +
   *  `closedPositions`. */
  closedPositions: BucketStockPosition[];
  orphanSells: StoredTxn[];
  realizedTrades: RealizedTrade[];
  realizedGainByTicker: Record<string, number>;
  totalRealizedGain: number;
  /** Every dividend ever paid in this bucket, across every ticker it has
   *  EVER held - not just currently-held ones. Deliberately separate from
   *  summing `positions[].totalDividends` (which silently drops any ticker
   *  that's since been fully sold, e.g. a stock bought, held through
   *  several dividend payments, then exited - same failure mode
   *  totalRealizedGain already had to be pulled out of `positions` to
   *  avoid). Use THIS for any bucket- or portfolio-level dividend total. */
  totalDividends: number;
} {
  const { holdings, orphanSells, realizedTrades } = computeHoldings(allTxns);
  const dividendsByTicker = sumDividendsByTicker(computeDividends(allTxns));
  const descriptionsByTicker = buildDescriptionsByTicker(allTxns);
  const realizedGainByTicker = sumRealizedGainByTicker(realizedTrades);

  // Holdings drive the base list (currently-held positions). A ticker with
  // dividend history but zero current holdings (fully sold) won't appear
  // here - see realizedGainByTicker/totalRealizedGain for closed-position
  // gains, which are tracked independently of this list.
  const positions: BucketStockPosition[] = holdings.map((h) => ({
    bucket: bucketName,
    ticker: h.ticker,
    openLots: h.openLots,
    totalQty: h.totalQty,
    avgCost: h.avgCost,
    totalCostBasis: h.totalCostBasis,
    totalDividends: dividendsByTicker[h.ticker] ?? 0,
    realizedGain: realizedGainByTicker[h.ticker] ?? 0,
    assetType: classifyAssetType(descriptionsByTicker[h.ticker]),
    pendingSettlement: h.pendingSettlement,
  }));

  // Anything with dividend or realized-gain history that ISN'T in current
  // holdings was transacted here and fully exited - surface it as a
  // zero-share closed position rather than letting it vanish.
  const heldTickers = new Set(holdings.map((h) => h.ticker));
  const closedTickers = new Set([...Object.keys(dividendsByTicker), ...Object.keys(realizedGainByTicker)]);
  const closedPositions: BucketStockPosition[] = [...closedTickers]
    .filter((ticker) => !heldTickers.has(ticker))
    .map((ticker) => ({
      bucket: bucketName,
      ticker,
      openLots: 0,
      totalQty: 0,
      avgCost: 0,
      totalCostBasis: 0,
      totalDividends: dividendsByTicker[ticker] ?? 0,
      realizedGain: realizedGainByTicker[ticker] ?? 0,
      assetType: classifyAssetType(descriptionsByTicker[ticker]),
    }));

  const totalRealizedGain = round(realizedTrades.reduce((s, t) => s + t.realizedGain, 0), 2);
  const totalDividends = round(Object.values(dividendsByTicker).reduce((s, d) => s + d, 0), 2);
  return { positions, closedPositions, orphanSells, realizedTrades, realizedGainByTicker, totalRealizedGain, totalDividends };
}

/** One ticker, merged across every bucket that holds it. */
export interface AggregatedStock {
  ticker: string;
  totalQty: number;
  avgCost: number;
  totalCostBasis: number;
  totalDividends: number;
  totalRealizedGain: number;
  assetType: AssetType;
  buckets: BucketStockPosition[];
  /** True if ANY contributing bucket-position is awaiting fund settlement -
   *  see Holding.pendingSettlement. */
  pendingSettlement?: boolean;
}

export function aggregateAcrossBuckets(allPositions: BucketStockPosition[]): AggregatedStock[] {
  const byTicker = new Map<string, BucketStockPosition[]>();
  for (const p of allPositions) {
    if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, []);
    byTicker.get(p.ticker)!.push(p);
  }
  const out: AggregatedStock[] = [];
  for (const [ticker, buckets] of byTicker) {
    const totalQty = round(buckets.reduce((s, b) => s + b.totalQty, 0), 2);
    const totalCostBasis = round(buckets.reduce((s, b) => s + b.totalCostBasis, 0), 2);
    const totalDividends = round(buckets.reduce((s, b) => s + b.totalDividends, 0), 2);
    const totalRealizedGain = round(buckets.reduce((s, b) => s + b.realizedGain, 0), 2);
    out.push({
      ticker,
      totalQty,
      totalCostBasis,
      totalDividends,
      totalRealizedGain,
      avgCost: totalQty > 0 ? round(totalCostBasis / totalQty, 4) : 0,
      assetType: buckets[0].assetType,
      buckets: [...buckets].sort((a, b) => b.totalCostBasis - a.totalCostBasis),
      pendingSettlement: buckets.some((b) => b.pendingSettlement),
    });
  }
  return out.sort((a, b) => b.totalCostBasis - a.totalCostBasis);
}

/** Same shape as AggregatedStock, but scoped to one ticker and built from
 *  its entries across EVERY bucket that has ever transacted it - including
 *  buckets where it's since been fully sold (those come in as zero-share
 *  `closedPositions` entries). This is what powers the stock detail
 *  screen's "Held In" list, which should show every bucket with history for
 *  the ticker, not just the ones still holding shares. `totalQty`/
 *  `totalCostBasis`/`avgCost` only reflect what's still held (a sold-out
 *  bucket contributes 0 to those), while `totalDividends`/
 *  `totalRealizedGain` are all-time sums across every bucket, matching the
 *  same philosophy as computeBucketPositions' totals. Returns null if the
 *  ticker has no history in any bucket at all. */
export function summarizeStockHistory(ticker: string, entries: BucketStockPosition[]): AggregatedStock | null {
  if (entries.length === 0) return null;
  const totalQty = round(entries.reduce((s, e) => s + e.totalQty, 0), 2);
  const totalCostBasis = round(entries.reduce((s, e) => s + e.totalCostBasis, 0), 2);
  const totalDividends = round(entries.reduce((s, e) => s + e.totalDividends, 0), 2);
  const totalRealizedGain = round(entries.reduce((s, e) => s + e.realizedGain, 0), 2);
  return {
    ticker,
    totalQty,
    totalCostBasis,
    totalDividends,
    totalRealizedGain,
    avgCost: totalQty > 0 ? round(totalCostBasis / totalQty, 4) : 0,
    assetType: entries[0].assetType,
    // Still-held buckets first (by cost basis, matching aggregateAcrossBuckets),
    // fully-exited ones (totalCostBasis 0) trail behind.
    buckets: [...entries].sort((a, b) => b.totalCostBasis - a.totalCostBasis || b.totalQty - a.totalQty),
    pendingSettlement: entries.some((e) => e.pendingSettlement),
  };
}

/** Portfolio-wide totals for the main dashboard header. */
export interface PortfolioSummary {
  totalCostBasis: number;
  /** Stock-only cost basis (excludes funds) - backs the "Stocks Total
   *  Portfolio Cost" stat, same convention as BucketDetailScreen's stocksCostBasis.
   *  Deliberately excludes Dividends Earned/Realized G/L, same as totalCostBasis -
   *  those are cash, not invested capital, and are surfaced as their own stats. */
  stocksCostBasis: number;
  /** Fund-only cost basis (excludes stocks) - backs "Funds Total Portfolio
   *  Cost". There's no equivalent "Funds Total Portfolio Value" number here -
   *  funds have no live price feed (priceCache.ts only carries PSE stock
   *  prices), so fund market value is surfaced as an explicit N/A in the UI
   *  rather than approximated. */
  fundsCostBasis: number;
  totalDividends: number;
  totalRealizedGain: number;
  realizedDividendYieldPct: number;
  bucketCount: number;
  stockCount: number;
  byBucket: { bucket: string; costBasis: number; percentage: number }[];
}

export function computePortfolioSummary(
  allPositions: BucketStockPosition[], totalRealizedGain: number = 0, totalDividendsOverride?: number
): PortfolioSummary {
  const totalCostBasis = round(allPositions.reduce((s, p) => s + p.totalCostBasis, 0), 2);
  const stocksCostBasis = round(
    allPositions.filter((p) => p.assetType === 'stock').reduce((s, p) => s + p.totalCostBasis, 0), 2
  );
  const fundsCostBasis = round(
    allPositions.filter((p) => p.assetType === 'fund').reduce((s, p) => s + p.totalCostBasis, 0), 2
  );
  // Prefer the caller-supplied all-time figure (sum of computeBucketPositions'
  // totalDividends across every bucket) - deriving it from allPositions alone
  // silently drops any ticker that's since been fully sold, the same failure
  // mode totalRealizedGain has. Falls back to the old (undercounting)
  // derivation only if the caller doesn't have that figure handy.
  const totalDividends = round(totalDividendsOverride ?? allPositions.reduce((s, p) => s + p.totalDividends, 0), 2);

  const bucketTotals = new Map<string, number>();
  for (const p of allPositions) {
    bucketTotals.set(p.bucket, (bucketTotals.get(p.bucket) ?? 0) + p.totalCostBasis);
  }
  const byBucket = Array.from(bucketTotals.entries())
    .map(([bucket, costBasis]) => ({
      bucket,
      costBasis: round(costBasis, 2),
      percentage: totalCostBasis > 0 ? round((costBasis / totalCostBasis) * 100, 1) : 0,
    }))
    .sort((a, b) => b.costBasis - a.costBasis);

  return {
    totalCostBasis,
    stocksCostBasis,
    fundsCostBasis,
    totalDividends,
    totalRealizedGain: round(totalRealizedGain, 2),
    // "Realized dividend yield" - dividends actually received, as a % of
    // what you paid. Distinct from a stock's quoted/current yield (which
    // is dividend / current PRICE) - this is dividend / YOUR cost basis,
    // i.e. your personal yield-on-cost across the whole portfolio.
    realizedDividendYieldPct: totalCostBasis > 0 ? round((totalDividends / totalCostBasis) * 100, 2) : 0,
    bucketCount: bucketTotals.size,
    stockCount: new Set(allPositions.map((p) => p.ticker)).size,
    byBucket,
  };
}

/** DD/MM/YYYY -> YYYY-MM-DD. Throws on malformed input rather than silently misparsing. */
export function normalizeDate(ddmmyyyy: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) throw new Error(`Unexpected date format: "${ddmmyyyy}" (expected DD/MM/YYYY)`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Content-based dedup key. Same fields/order as the Python version - keep these in sync. */
export function rowHash(r: RawRow): string {
  const key = [
    r.Date, r.Type, r.Stock ?? '', r.Quantity ?? '', r.Price ?? '',
    r['Comm & Other Fees'] ?? '', r.Amount ?? '', r.Description ?? ''
  ].join('|');
  // djb2 - good enough for local dedup; not cryptographic, doesn't need to be.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

export function prepareRows(raw: RawRow[]): StoredTxn[] {
  return raw.map(r => ({ ...r, rowHash: rowHash(r), isoDate: normalizeDate(r.Date) }));
}

/**
 * Given ALL stored transactions for one bucket (already deduped), reconstruct
 * current holdings via FIFO. Mirrors parse_dragonfi.py exactly, including the
 * same "orphan sell" behavior: a SELL with no prior lot in this data set is
 * skipped rather than going negative, and reported separately so it's visible
 * instead of silently wrong.
 */
export function computeHoldings(txns: StoredTxn[]): { holdings: Holding[]; orphanSells: StoredTxn[]; realizedTrades: RealizedTrade[] } {
  const sorted = [...txns]
    .filter(t => (t.Type === 'BUY' || t.Type === 'SELL') && t.Quantity != null)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  // Feeder-fund lump-sum buys (e.g. Manulife funds bought for a flat peso
  // amount) often land in the export with Quantity/Price both blank -
  // DragonFi doesn't back-fill units/NAVPU until the fund settles a few
  // days later. Rather than dropping that invested peso amount entirely
  // (the old behavior), track it separately here so it can still surface
  // as a cost-basis-only holding below.
  const pendingCostByTicker = new Map<string, { cost: number; count: number }>();
  for (const t of txns) {
    if (t.Type === 'BUY' && t.Quantity == null && t.Stock != null && t.Amount != null) {
      const ticker = t.Stock;
      const entry = pendingCostByTicker.get(ticker) ?? { cost: 0, count: 0 };
      entry.cost += Math.abs(t.Amount);
      entry.count += 1;
      pendingCostByTicker.set(ticker, entry);
    }
  }

  const lots = new Map<string, { qty: number; unitCost: number }[]>();
  const orphanSells: StoredTxn[] = [];
  const realizedTrades: RealizedTrade[] = [];

  for (const t of sorted) {
    const ticker = t.Stock!;
    const qty = Math.abs(t.Quantity!);
    const fees = t['Comm & Other Fees'] ?? 0;
    if (!lots.has(ticker)) lots.set(ticker, []);
    const dq = lots.get(ticker)!;

    if (t.Type === 'BUY') {
      dq.push({ qty, unitCost: t.Price! + fees / qty });
    } else {
      let toSell = qty;
      let qtyMatched = 0;
      let costBasisMatched = 0;
      if (dq.length === 0) { orphanSells.push(t); continue; }
      while (toSell > 0 && dq.length > 0) {
        const lot = dq[0];
        const consumed = Math.min(lot.qty, toSell);
        costBasisMatched += consumed * lot.unitCost;
        qtyMatched += consumed;
        lot.qty -= consumed;
        toSell -= consumed;
        if (lot.qty <= 0.0001) dq.shift();
      }
      if (toSell > 0.0001) orphanSells.push(t); // partially orphaned
      if (qtyMatched > 0.0001) {
        // Fees are attributed to the matched portion proportionally, in the
        // (rare) case a sell is partially orphaned.
        const proceeds = qtyMatched * t.Price! - fees * (qtyMatched / qty);
        realizedTrades.push({
          ticker,
          sellDate: t.isoDate,
          quantity: round(qtyMatched, 4),
          sellPrice: t.Price!,
          costBasis: round(costBasisMatched, 2),
          proceeds: round(proceeds, 2),
          realizedGain: round(proceeds - costBasisMatched, 2),
        });
      }
    }
  }

  const holdings: Holding[] = [];
  for (const [ticker, dq] of lots) {
    const totalQty = dq.reduce((s, l) => s + l.qty, 0);
    if (totalQty <= 0.0001) continue;
    const totalCost = dq.reduce((s, l) => s + l.qty * l.unitCost, 0);
    holdings.push({
      ticker, openLots: dq.length, totalQty: round(totalQty, 2),
      avgCost: round(totalCost / totalQty, 4), totalCostBasis: round(totalCost, 2)
    });
  }

  // Fold pending (qty-less) fund buys into holdings: merge into a ticker
  // that already has share-tracked lots (its invested peso amount just
  // grows, qty/avgCost stay as-is since that portion's shares aren't known
  // yet), or - the common case - add it as a brand-new cost-only holding
  // for a ticker with no FIFO lots at all.
  for (const [ticker, { cost, count }] of pendingCostByTicker) {
    const existing = holdings.find((h) => h.ticker === ticker);
    if (existing) {
      existing.totalCostBasis = round(existing.totalCostBasis + cost, 2);
      existing.pendingSettlement = true;
    } else {
      holdings.push({
        ticker,
        openLots: count,
        totalQty: 0,
        avgCost: 0,
        totalCostBasis: round(cost, 2),
        pendingSettlement: true,
      });
    }
  }

  return { holdings, orphanSells, realizedTrades };
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ---- Price valuation (depends on external, live price data - the caller
// supplies it; this layer stays pure and testable, same as everything else) ----

export interface PriceLookup {
  [ticker: string]: { price: number; yieldPct: number | null };
}

export interface ValuedStockPosition extends BucketStockPosition {
  currentPrice: number | null;
  currentYieldPct: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
}

export function applyPricesToPositions(
  positions: BucketStockPosition[], prices: PriceLookup
): ValuedStockPosition[] {
  return positions.map((p) => {
    // Pending fund buys have no share count yet, so qty * price would
    // wrongly value them at ₱0 even though real money is invested. Show
    // them at cost (0 unrealized gain) until a later import fills in the
    // actual Quantity/Price and this position joins normal FIFO holdings.
    if (p.pendingSettlement) {
      return { ...p, currentPrice: null, currentYieldPct: null, marketValue: p.totalCostBasis, unrealizedGain: 0, unrealizedGainPct: 0 };
    }
    const priceData = prices[p.ticker];
    if (!priceData) {
      return { ...p, currentPrice: null, currentYieldPct: null, marketValue: null, unrealizedGain: null, unrealizedGainPct: null };
    }
    const marketValue = round(p.totalQty * priceData.price, 2);
    const unrealizedGain = round(marketValue - p.totalCostBasis, 2);
    const unrealizedGainPct = p.totalCostBasis > 0 ? round((unrealizedGain / p.totalCostBasis) * 100, 2) : 0;
    return {
      ...p,
      currentPrice: priceData.price,
      currentYieldPct: priceData.yieldPct,
      marketValue,
      unrealizedGain,
      unrealizedGainPct,
    };
  });
}

export interface ValuedAggregatedStock extends Omit<AggregatedStock, 'buckets'> {
  currentPrice: number | null;
  currentYieldPct: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  buckets: ValuedStockPosition[];
}

export function applyPricesToAggregated(
  stocks: AggregatedStock[], prices: PriceLookup
): ValuedAggregatedStock[] {
  return stocks.map((s) => {
    const valuedBuckets = applyPricesToPositions(s.buckets, prices);
    if (s.pendingSettlement) {
      return { ...s, buckets: valuedBuckets, currentPrice: null, currentYieldPct: null, marketValue: s.totalCostBasis, unrealizedGain: 0, unrealizedGainPct: 0 };
    }
    const priceData = prices[s.ticker];
    if (!priceData) {
      return { ...s, buckets: valuedBuckets, currentPrice: null, currentYieldPct: null, marketValue: null, unrealizedGain: null, unrealizedGainPct: null };
    }
    const marketValue = round(s.totalQty * priceData.price, 2);
    const unrealizedGain = round(marketValue - s.totalCostBasis, 2);
    const unrealizedGainPct = s.totalCostBasis > 0 ? round((unrealizedGain / s.totalCostBasis) * 100, 2) : 0;
    return {
      ...s,
      buckets: valuedBuckets,
      currentPrice: priceData.price,
      currentYieldPct: priceData.yieldPct,
      marketValue,
      unrealizedGain,
      unrealizedGainPct,
    };
  });
}

export interface PortfolioValuation {
  totalMarketValue: number;
  totalUnrealizedGain: number;
  totalUnrealizedGainPct: number;
  totalReturn: number; // unrealized gain + realized gain + dividends earned
  totalReturnPct: number;
  pricedTickers: number;
  unpricedTickers: number;
}

/** Sums market value across positions, optionally scoped to one asset type -
 *  what backs "Stocks Total Portfolio Value" (assetType 'stock'). Only counts
 *  priced positions (marketValue != null), same convention as
 *  computePortfolioValuation, so an unpriced holding doesn't silently count
 *  as ₱0 - it's reported separately via unpricedCount instead. */
export function sumMarketValue<T extends { assetType: AssetType; marketValue: number | null }>(
  positions: T[], assetType?: AssetType
): { value: number; pricedCount: number; unpricedCount: number } {
  const filtered = assetType ? positions.filter((p) => p.assetType === assetType) : positions;
  const priced = filtered.filter((p) => p.marketValue != null);
  return {
    value: round(priced.reduce((s, p) => s + (p.marketValue ?? 0), 0), 2),
    pricedCount: priced.length,
    unpricedCount: filtered.length - priced.length,
  };
}

/** Only counts tickers that actually have a price - unpriced ones are excluded
 *  from the gain/loss math (reported separately) rather than silently treated as 0. */
export function computePortfolioValuation(
  valuedPositions: ValuedStockPosition[], totalDividends: number, totalCostBasis: number, totalRealizedGain: number = 0
): PortfolioValuation {
  const priced = valuedPositions.filter((p) => p.marketValue != null);
  const totalMarketValue = round(priced.reduce((s, p) => s + (p.marketValue ?? 0), 0), 2);
  const pricedCostBasis = round(priced.reduce((s, p) => s + p.totalCostBasis, 0), 2);
  const totalUnrealizedGain = round(totalMarketValue - pricedCostBasis, 2);
  const totalUnrealizedGainPct = pricedCostBasis > 0 ? round((totalUnrealizedGain / pricedCostBasis) * 100, 2) : 0;
  const totalReturn = round(totalUnrealizedGain + totalRealizedGain + totalDividends, 2);
  const totalReturnPct = totalCostBasis > 0 ? round((totalReturn / totalCostBasis) * 100, 2) : 0;
  return {
    totalMarketValue,
    totalUnrealizedGain,
    totalUnrealizedGainPct,
    totalReturn,
    totalReturnPct,
    pricedTickers: priced.length,
    unpricedTickers: valuedPositions.length - priced.length,
  };
}

/** One CASH DIVIDEND payment tagged with the bucket it was earned in -
 *  powers the Monthly Dividend Income chart/screen, both aggregated across
 *  all buckets (Dashboard) and scoped to one bucket (BucketDetail). Same
 *  underlying data as DividendEntry, just with the bucket name attached
 *  (DividendEntry alone can't tell two same-ticker dividends in different
 *  buckets apart, which the "declared payouts" list needs to do). */
export interface DividendPayment {
  date: string;      // isoDate, YYYY-MM-DD
  ticker: string;
  amount: number;
  bucket: string;
}

/** Buckets a list of dividend payments into 12 monthly totals (index 0 =
 *  January) for one calendar year, matched against the isoDate's year. */
export function monthlyDividendTotals(payments: { date: string; amount: number }[], year: number): number[] {
  const totals = new Array(12).fill(0);
  for (const p of payments) {
    const [y, m] = p.date.split('-');
    if (Number(y) !== year) continue;
    const month = Number(m);
    if (month >= 1 && month <= 12) totals[month - 1] = round(totals[month - 1] + p.amount, 2);
  }
  return totals;
}

/** Average monthly dividend income across every COMPLETED calendar month
 *  from the first-ever payment through the month before `asOf` - the
 *  current, still-in-progress month is deliberately excluded, since a
 *  slow start to this month (most dividends land on specific dates, not
 *  smoothly across the month) would otherwise drag a perfectly healthy
 *  average down before the month is even over. This is what the Passive
 *  Income Goal gauge shows instead of just "this month's total so far" -
 *  a lumpy dividend calendar means that number is near-zero for most of
 *  any given month by construction, which reads as "behind goal" even for
 *  a portfolio comfortably producing the target income on average.
 *
 *  Months with zero payments (a natural gap between quarterly payers,
 *  for instance) count as 0 in the average rather than being excluded -
 *  they're real months where nothing arrived, and should pull the
 *  average down accordingly, not be smoothed away. Returns 0 if there
 *  are no completed months yet (e.g. the very first month of investing). */
export function averageMonthlyDividendIncome(payments: { date: string; amount: number }[], asOf: Date = new Date()): number {
  if (payments.length === 0) return 0;

  const monthKey = (y: number, m1to12: number) => `${y}-${String(m1to12).padStart(2, '0')}`;

  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const firstMonthKey = sorted[0].date.slice(0, 7);

  const lastCompleted = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const lastMonthKey = monthKey(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1);

  if (lastMonthKey < firstMonthKey) return 0; // first payment is in the current, still-in-progress month

  const totalInRange = payments
    .filter((p) => { const k = p.date.slice(0, 7); return k >= firstMonthKey && k <= lastMonthKey; })
    .reduce((s, p) => s + p.amount, 0);

  const [fy, fm] = firstMonthKey.split('-').map(Number);
  const [ly, lm] = lastMonthKey.split('-').map(Number);
  const monthCount = (ly - fy) * 12 + (lm - fm) + 1;

  return monthCount > 0 ? round(totalInRange / monthCount, 2) : 0;
}

/** Distinct calendar years present in a list of dividend payments, newest
 *  first - builds the year tabs on the Monthly Dividend Income screen.
 *  Always includes currentYear even with zero payments yet, so the tab
 *  for "this year" doesn't disappear just because nothing's landed yet. */
export function dividendYearsAvailable(payments: { date: string }[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const p of payments) years.add(Number(p.date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

/** Minimal structural shape for a yield-bracket lookup - deliberately NOT
 *  importing BucketRow from storeApi here, since storeApi already imports
 *  from this file (bucketLogic.ts) and importing back would create a
 *  circular dependency. Any object with these three fields works,
 *  including the real BucketRow from storeApi.ts. */
export interface YieldBracket {
  name: string;
  yield_low: number | null;
  yield_high: number | null;
}

export interface BucketSuggestion {
  bucket: YieldBracket | null;
  reason: 'match' | 'no_buckets_configured' | 'no_matching_range';
  /** Only set when reason is 'no_matching_range' - the closest bracket by
   *  distance, so the UI can say "closest is B5 (6%-7.5%)" rather than
   *  just "nothing fits." */
  nearestBucket?: YieldBracket;
}

/** The core "AREIT - 6.5% div yield - buy on what bucket?" feature:
 *  matches a stock's dividend yield against configured bucket brackets
 *  (yield_low <= yieldPct < yield_high) and returns which bucket it
 *  belongs in. Buckets without both a low and high configured are
 *  ignored - they can't participate in yield matching. */
export function suggestBucketForYield(yieldPct: number, buckets: YieldBracket[]): BucketSuggestion {
  const withRange = buckets.filter((b): b is YieldBracket & { yield_low: number; yield_high: number } =>
    b.yield_low != null && b.yield_high != null
  );
  if (withRange.length === 0) {
    return { bucket: null, reason: 'no_buckets_configured' };
  }
  const match = withRange.find((b) => yieldPct >= b.yield_low && yieldPct < b.yield_high);
  if (match) {
    return { bucket: match, reason: 'match' };
  }
  let nearest = withRange[0];
  let nearestDistance = Infinity;
  for (const b of withRange) {
    const distance = yieldPct < b.yield_low ? b.yield_low - yieldPct : yieldPct - b.yield_high;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = b;
    }
  }
  return { bucket: null, reason: 'no_matching_range', nearestBucket: nearest };
}