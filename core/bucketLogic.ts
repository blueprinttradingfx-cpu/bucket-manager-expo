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
}

export interface DividendEntry { ticker: string; date: string; amount: number; }

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
}

/** Combines FIFO holdings + dividend totals for a single bucket's full transaction history. */
export function computeBucketPositions(
  bucketName: string, allTxns: StoredTxn[]
): { positions: BucketStockPosition[]; orphanSells: StoredTxn[] } {
  const { holdings, orphanSells } = computeHoldings(allTxns);
  const dividendsByTicker = sumDividendsByTicker(computeDividends(allTxns));

  // Holdings drive the base list (currently-held positions). A ticker with
  // dividend history but zero current holdings (fully sold) won't appear
  // here yet - dividend-only rows for exited positions are a possible
  // future addition, not covered by this pass.
  const positions: BucketStockPosition[] = holdings.map((h) => ({
    bucket: bucketName,
    ticker: h.ticker,
    openLots: h.openLots,
    totalQty: h.totalQty,
    avgCost: h.avgCost,
    totalCostBasis: h.totalCostBasis,
    totalDividends: dividendsByTicker[h.ticker] ?? 0,
  }));
  return { positions, orphanSells };
}

/** One ticker, merged across every bucket that holds it. */
export interface AggregatedStock {
  ticker: string;
  totalQty: number;
  avgCost: number;
  totalCostBasis: number;
  totalDividends: number;
  buckets: BucketStockPosition[];
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
    out.push({
      ticker,
      totalQty,
      totalCostBasis,
      totalDividends,
      avgCost: totalQty > 0 ? round(totalCostBasis / totalQty, 4) : 0,
      buckets: [...buckets].sort((a, b) => b.totalCostBasis - a.totalCostBasis),
    });
  }
  return out.sort((a, b) => b.totalCostBasis - a.totalCostBasis);
}

/** Portfolio-wide totals for the main dashboard header. */
export interface PortfolioSummary {
  totalCostBasis: number;
  totalDividends: number;
  realizedDividendYieldPct: number;
  bucketCount: number;
  stockCount: number;
  byBucket: { bucket: string; costBasis: number; percentage: number }[];
}

export function computePortfolioSummary(allPositions: BucketStockPosition[]): PortfolioSummary {
  const totalCostBasis = round(allPositions.reduce((s, p) => s + p.totalCostBasis, 0), 2);
  const totalDividends = round(allPositions.reduce((s, p) => s + p.totalDividends, 0), 2);

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
    totalDividends,
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
export function computeHoldings(txns: StoredTxn[]): { holdings: Holding[]; orphanSells: StoredTxn[] } {
  const sorted = [...txns]
    .filter(t => (t.Type === 'BUY' || t.Type === 'SELL') && t.Quantity != null)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const lots = new Map<string, { qty: number; unitCost: number }[]>();
  const orphanSells: StoredTxn[] = [];

  for (const t of sorted) {
    const ticker = t.Stock!;
    const qty = t.Quantity!;
    const fees = t['Comm & Other Fees'] ?? 0;
    if (!lots.has(ticker)) lots.set(ticker, []);
    const dq = lots.get(ticker)!;

    if (qty > 0) {
      dq.push({ qty, unitCost: t.Price! + fees / qty });
    } else {
      let toSell = -qty;
      if (dq.length === 0) { orphanSells.push(t); continue; }
      while (toSell > 0 && dq.length > 0) {
        const lot = dq[0];
        const consumed = Math.min(lot.qty, toSell);
        lot.qty -= consumed;
        toSell -= consumed;
        if (lot.qty <= 0.0001) dq.shift();
      }
      if (toSell > 0.0001) orphanSells.push(t); // partially orphaned
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
  return { holdings, orphanSells };
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
    const priceData = prices[s.ticker];
    const valuedBuckets = applyPricesToPositions(s.buckets, prices);
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
  totalReturn: number; // unrealized gain + dividends earned
  totalReturnPct: number;
  pricedTickers: number;
  unpricedTickers: number;
}

/** Only counts tickers that actually have a price - unpriced ones are excluded
 *  from the gain/loss math (reported separately) rather than silently treated as 0. */
export function computePortfolioValuation(
  valuedPositions: ValuedStockPosition[], totalDividends: number, totalCostBasis: number
): PortfolioValuation {
  const priced = valuedPositions.filter((p) => p.marketValue != null);
  const totalMarketValue = round(priced.reduce((s, p) => s + (p.marketValue ?? 0), 0), 2);
  const pricedCostBasis = round(priced.reduce((s, p) => s + p.totalCostBasis, 0), 2);
  const totalUnrealizedGain = round(totalMarketValue - pricedCostBasis, 2);
  const totalUnrealizedGainPct = pricedCostBasis > 0 ? round((totalUnrealizedGain / pricedCostBasis) * 100, 2) : 0;
  const totalReturn = round(totalUnrealizedGain + totalDividends, 2);
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
