// screens/DashboardScreen.tsx
// Level 1: the main aggregated dashboard. Restyled to match the Stitch
// design export (stitch_bucket_portfolio_design_system[_mobile].zip) -
// light "Fintech Terminal" theme, Inter + JetBrains Mono, stat card row,
// and a "Yield Distribution" bar using the real per-bucket colors from
// core/theme's bucketColorFor (falls back to a neutral palette for bucket
// names that don't follow the B1-B5 convention).
//
// Portfolio totals + one row per TICKER merged across buckets. Layers in
// live price/yield data from two independent GitHub Actions pipelines where
// available - stock prices/yields (priceCache.ts) and mutual fund NAVPU
// (fundCache.ts) - merged into one lookup before valuation runs, so market
// value/unrealized gain/current yield cover both asset types the same way.
// Gracefully degrades to cost-basis-only for whichever feed(s) can't be
// reached - never blocks the core view on it.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, PortfolioSummary, ValuedAggregatedStock, applyPricesToAggregated, computePortfolioValuation, PortfolioValuation, sumMarketValue, YieldBracket, DividendPayment, monthlyDividendTotals, averageMonthlyDividendIncome } from '../core/bucketLogic';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { fetchFundCache, FundCache, fundCacheToPriceLookup } from '../core/fundCache';
import { DashboardStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, bucketColorFor, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { useResponsive } from '../core/responsive';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import BucketSuggestion from './components/BucketSuggestion';
import MonthlyDividendChart from './components/MonthlyDividendChart';
import PassiveIncomeGoalCard from './components/PassiveIncomeGoalCard';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>;

type StockRow = ValuedAggregatedStock | AggregatedStock;

function isValued(s: StockRow): s is ValuedAggregatedStock {
  return 'marketValue' in s;
}

function toPositionItem(item: StockRow, yieldBuckets: YieldBracket[], colors: ThemeColors, styles: ReturnType<typeof createStyles>): PositionItem {
  const valued = isValued(item) ? item : null;
  return {
    key: item.ticker,
    label: item.ticker,
    badgeText: item.ticker.slice(0, 2),
    badgeVariant: item.assetType,
    assetType: item.assetType,
    qty: item.totalQty,
    avgCost: item.avgCost,
    costBasis: item.totalCostBasis,
    dividends: item.totalDividends,
    currentPrice: valued?.currentPrice ?? null,
    marketValue: valued?.marketValue ?? null,
    unrealizedGain: valued?.unrealizedGain ?? null,
    unrealizedGainPct: valued?.unrealizedGainPct ?? null,
    pendingSettlement: item.pendingSettlement,
    expandedContent: (
      <>
        <ExpandedRow label="Market Value" value={`₱${(valued?.marketValue ?? item.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <ExpandedRow label="Avg Cost" value={`₱${item.avgCost}`} />
        <ExpandedRow label="Dividends Earned" value={`₱${item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} valueStyle={item.totalDividends > 0 ? { color: colors.positive } : undefined} />
        {item.pendingSettlement && (
          <ExpandedRow label="Status" value="Awaiting NAVPU from statement" />
        )}
        <View style={styles.bucketChipsLabel}><Text style={styles.bucketChipsLabelText}>Buckets</Text></View>
        <View style={styles.bucketChipsGrid}>
          {item.buckets.map((b, i) => (
            <View key={b.bucket} style={styles.bucketChip}>
              <Text style={[styles.bucketChipLabel, { color: bucketColorFor(b.bucket, i) }]}>{b.bucket}</Text>
              <Text style={styles.bucketChipValue}>{b.totalQty.toLocaleString()} sh · ₱{b.totalCostBasis.toLocaleString(undefined, { minimumFractionDigits: 0 })}</Text>
            </View>
          ))}
        </View>
        {/* Same "where should I buy more" logic as StockDetailScreen, so a
            person deciding whether to add to a position doesn't need to
            drill in another level just to see it. */}
        <View style={styles.bucketSuggestion}>
          <BucketSuggestion ticker={item.ticker} yieldPct={valued?.currentYieldPct ?? null} buckets={yieldBuckets} />
        </View>
      </>
    ),
  };
}

// Builds a StatCard sublabel like "+2.15% · 1 unpriced" for the value cards -
// % change first (when the relevant scoped valuation is available), then
// unpriced-count tacked on so that signal isn't lost now that the sublabel
// slot is doing double duty.
function valueCardSublabel(scopedValuation: PortfolioValuation | null, unpricedCount?: number): string | undefined {
  const parts: string[] = [];
  if (scopedValuation) {
    const pct = scopedValuation.totalUnrealizedGainPct;
    parts.push(`${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (unpricedCount && unpricedCount > 0) {
    parts.push(`${unpricedCount} unpriced`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export default function DashboardScreen({ navigation }: Props) {
  useScreenViewLog('Dashboard');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isWideWeb } = useResponsive();
  const store = useStore();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [yieldBuckets, setYieldBuckets] = useState<YieldBracket[]>([]);
  const [dividendFeed, setDividendFeed] = useState<DividendPayment[]>([]);
  const [monthlyGoal, setMonthlyGoal] = useState<number | null>(null);
  const [valuation, setValuation] = useState<PortfolioValuation | null>(null);
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
  const [fundCache, setFundCache] = useState<FundCache | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'stock' | 'fund'>('all');

  const load = useCallback(async (forcePrices = false) => {
    const [s, a, b, d, g] = await Promise.all([
      store.getPortfolioSummary(), store.getAggregatedStocks(), store.listBuckets(), store.getDividendFeed(),
      store.getMonthlyIncomeGoal(),
    ]);
    setSummary(s);
    setYieldBuckets(b);
    setDividendFeed(d);
    setMonthlyGoal(g);

    // Stock prices (priceCache.ts) and fund NAVPU (fundCache.ts) are two
    // independent feeds - fetch both, but don't let either one's failure
    // block the other. applyPricesToAggregated doesn't care which feed a
    // ticker's price came from, so whatever comes back just gets merged into
    // one lookup. Same "never blocks the core view" degradation as before,
    // just extended to cover funds too now that they have a live feed.
    const [priceResult, fundResult] = await Promise.allSettled([
      fetchPriceCache(undefined, { force: forcePrices }),
      fetchFundCache(undefined, { force: forcePrices }),
    ]);

    const prices = priceResult.status === 'fulfilled' ? priceResult.value : null;
    const funds = fundResult.status === 'fulfilled' ? fundResult.value : null;
    setPriceCache(prices);
    setFundCache(funds);

    if (priceResult.status === 'rejected') {
      console.log('[Dashboard] price cache unavailable:', priceResult.reason?.message);
    }
    if (fundResult.status === 'rejected') {
      console.log('[Dashboard] fund cache unavailable:', fundResult.reason?.message);
    }
    // Kept scoped to the stock feed specifically - the warning this gates
    // ("can't show unrealized gain/loss") is about stocksOnlyValuation,
    // which is stock-only math, so a fund-cache-only outage shouldn't trip it.
    setPriceError(priceResult.status === 'rejected' ? (priceResult.reason?.message ?? 'Live prices unavailable') : null);

    if (!prices && !funds) {
      setStocks(a);
      setValuation(null);
      return;
    }
    const mergedLookup = { ...(prices?.tickers ?? {}), ...fundCacheToPriceLookup(funds) };
    const valued = applyPricesToAggregated(a, mergedLookup);
    setStocks(valued);
    const flatPositions = valued.flatMap((v) => v.buckets);
    setValuation(computePortfolioValuation(flatPositions, s.totalDividends, s.totalCostBasis, s.totalRealizedGain));
  }, [store]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  async function handleSaveGoal(goal: number) {
    await store.setMonthlyIncomeGoal(goal);
    setMonthlyGoal(goal);
  }

  const stockCount = useMemo(() => stocks.filter((s) => s.assetType === 'stock').length, [stocks]);
  const fundCount = useMemo(() => stocks.filter((s) => s.assetType === 'fund').length, [stocks]);
  // Stocks Total Portfolio Value - market value of stock-type holdings only.
  const stocksValueInfo = useMemo(
    () => (valuation ? sumMarketValue(stocks as ValuedAggregatedStock[], 'stock') : null),
    [stocks, valuation]
  );
  // Funds Total Portfolio Value - now backed by fundCache.ts's live NAVPU
  // feed (funds.json), merged into the same lookup as stock prices before
  // valuation runs. A fund whose ticker isn't in that feed still falls back
  // to null marketValue (counted under unpricedCount) rather than N/A for
  // the whole card, same convention as an unpriced stock.
  const fundsValueInfo = useMemo(
    () => (valuation ? sumMarketValue(stocks as ValuedAggregatedStock[], 'fund') : null),
    [stocks, valuation]
  );
  // Scoped unrealized-gain delta shown under the "Total Investment" headline -
  // stock-only (see stocksOnlyValuation's own computePortfolioValuation call
  // below, scoped via valuedStockBuckets) - this is specifically the
  // pre-existing "stocks-only" callout under Total Investment, not the
  // portfolio-wide total which now includes funds via `valuation` above.
  const stocksOnlyValuation = useMemo(() => {
    if (!valuation || !summary) return null;
    const valuedStockBuckets = (stocks as ValuedAggregatedStock[])
      .filter((s) => s.assetType === 'stock')
      .flatMap((s) => s.buckets);
    return computePortfolioValuation(valuedStockBuckets, 0, summary.stocksCostBasis, 0);
  }, [stocks, valuation, summary]);
  // Same idea as stocksOnlyValuation above, just scoped to fund positions -
  // powers the % change under the Funds Total Portfolio Value card.
  const fundsOnlyValuation = useMemo(() => {
    if (!valuation || !summary) return null;
    const valuedFundBuckets = (stocks as ValuedAggregatedStock[])
      .filter((s) => s.assetType === 'fund')
      .flatMap((s) => s.buckets);
    return computePortfolioValuation(valuedFundBuckets, 0, summary.fundsCostBasis, 0);
  }, [stocks, valuation, summary]);
  const visible = useMemo(
    () => (activeTab === 'all' ? stocks : stocks.filter((s) => s.assetType === activeTab)).map((item) => toPositionItem(item, yieldBuckets, colors, styles)),
    [stocks, activeTab, yieldBuckets, colors, styles]
  );
  const currentYear = new Date().getFullYear();
  const monthlyDividends = useMemo(() => monthlyDividendTotals(dividendFeed, currentYear), [dividendFeed, currentYear]);
  // Average across completed months, not just this month's total so far -
  // see averageMonthlyDividendIncome's own comment for why: dividends land
  // on specific dates, not smoothly, so "this month so far" reads as
  // "behind goal" for most of any given month even when the portfolio is
  // comfortably on track.
  const averageMonthlyIncome = useMemo(() => averageMonthlyDividendIncome(dividendFeed), [dividendFeed]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >

      {summary && (
        <>
          <View style={styles.marketValueBlock}>
            <Text style={styles.caption}>Total Investment</Text>
            <Text style={styles.marketValue}>
              ₱{summary.totalCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
            {stocksOnlyValuation && (
              <Text style={[styles.deltaLine, stocksOnlyValuation.totalUnrealizedGain >= 0 ? styles.positive : styles.negative]}>
                {stocksOnlyValuation.totalUnrealizedGain >= 0 ? '↑' : '↓'} ₱{Math.abs(stocksOnlyValuation.totalUnrealizedGain).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {' '}({stocksOnlyValuation.totalUnrealizedGainPct >= 0 ? '+' : ''}{stocksOnlyValuation.totalUnrealizedGainPct}%) unrealized on stocks
              </Text>
            )}
            {(priceCache || fundCache) && (
              <Text style={styles.pricesAsOf}>
                Prices as of {new Date((priceCache ?? fundCache)!.generatedAt).toLocaleString()}
              </Text>
            )}
            {priceError && <Text style={styles.priceWarning}>Live prices unavailable - can't show unrealized gain/loss right now.</Text>}
          </View>

          {(() => {
            const statCards = (
              <>
                <StatCard wide={isWideWeb} label="Stocks Total Portfolio Cost" value={`₱${summary.stocksCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                <StatCard
                  wide={isWideWeb}
                  label="Stocks Total Portfolio Value"
                  value={stocksValueInfo ? `₱${stocksValueInfo.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
                  sublabel={valueCardSublabel(stocksOnlyValuation, stocksValueInfo?.unpricedCount)}
                  sign={stocksOnlyValuation ? (stocksOnlyValuation.totalUnrealizedGain >= 0 ? 'positive' : 'negative') : undefined}
                />
                <StatCard wide={isWideWeb} label="Funds Total Portfolio Cost" value={`₱${summary.fundsCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                <StatCard
                  wide={isWideWeb}
                  label="Funds Total Portfolio Value"
                  value={fundsValueInfo && fundsValueInfo.pricedCount > 0 ? `₱${fundsValueInfo.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
                  sublabel={fundsValueInfo && fundsValueInfo.pricedCount > 0 ? valueCardSublabel(fundsOnlyValuation, fundsValueInfo.unpricedCount) : undefined}
                  sign={fundsValueInfo && fundsValueInfo.pricedCount > 0 && fundsOnlyValuation ? (fundsOnlyValuation.totalUnrealizedGain >= 0 ? 'positive' : 'negative') : undefined}
                />
                <StatCard wide={isWideWeb} label="Dividends Earned" value={`₱${summary.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} sublabel={`${summary.realizedDividendYieldPct}% of cost`} sign="positive" />
                <StatCard
                  wide={isWideWeb}
                  label="Realized Gain/Loss"
                  value={`${summary.totalRealizedGain >= 0 ? '+' : ''}₱${summary.totalRealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  sublabel="from closed positions"
                  sign={summary.totalRealizedGain >= 0 ? 'positive' : 'negative'}
                />
                <StatCard wide={isWideWeb} label="Stocks" value={String(summary.stockCount)} sublabel="Active Positions" />
                <StatCard wide={isWideWeb} label="Buckets" value={String(summary.bucketCount)} sublabel="Active Accounts" />
                {valuation && (
                  <StatCard
                    wide={isWideWeb}
                    label="Total Return"
                    value={`₱${valuation.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gains)`}
                    sign={valuation.totalReturn >= 0 ? 'positive' : 'negative'}
                  />
                )}
              </>
            );
            // Wide web: cards wrap into a proper grid that fills the row -
            // a horizontal-scroll strip on a desktop-sized viewport just
            // leaves the rest of the row empty, which is the "phone layout
            // stretched onto a monitor" look. Phones/narrow web keep the
            // swipeable strip, which is the better fit for a thumb.
            return isWideWeb ? (
              <View style={styles.statsGrid}>{statCards}</View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll} contentContainerStyle={styles.statsRow}>
                {statCards}
              </ScrollView>
            );
          })()}

          <PassiveIncomeGoalCard
            averageMonthlyIncome={averageMonthlyIncome}
            goal={monthlyGoal}
            onSaveGoal={handleSaveGoal}
          />

          {summary.byBucket.length > 0 && (
            <View style={styles.yieldCard}>
              <View style={styles.yieldCardHeader}>
                <Text style={styles.yieldCardTitle}>Yield Distribution</Text>
              </View>
              <View style={styles.allocationBar}>
                {summary.byBucket.map((b, i) => (
                  <View key={b.bucket} style={{ flex: b.percentage, backgroundColor: bucketColorFor(b.bucket, i), height: '100%' }} />
                ))}
              </View>
              <View style={styles.legendGrid}>
                {summary.byBucket.map((b, i) => (
                  <View key={b.bucket} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: bucketColorFor(b.bucket, i) }]} />
                    <Text style={styles.legendText}>{b.bucket} {b.percentage}%</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      <MonthlyDividendChart
        year={currentYear}
        monthlyTotals={monthlyDividends}
        onViewAll={() => navigation.navigate('MonthlyDividendIncome', {})}
      />

      <Text style={styles.positionsHeader}>Positions</Text>

      <PositionsTable
        items={visible}
        onItemPress={(ticker) => navigation.navigate('StockDetail', { ticker })}
        tabs={[
          { key: 'all', label: 'All', count: stocks.length },
          { key: 'stock', label: 'Stocks', count: stockCount },
          { key: 'fund', label: 'Funds', count: fundCount },
        ]}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as 'all' | 'stock' | 'fund')}
        emptyText={stocks.length === 0 ? 'No holdings yet. Import a statement to get started.' : `No ${activeTab === 'fund' ? 'funds' : 'stocks'} in this view.`}
      />
    </ScrollView>
  );
}

function StatCard({ label, value, sublabel, sign, wide }: { label: string; value: string; sublabel?: string; sign?: 'positive' | 'negative'; wide?: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.statCard, wide && styles.statCardGrid]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: spacing.sm },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  marketValueBlock: { marginBottom: spacing.lg },
  marketValue: { fontFamily: fonts.bodySemiBold, fontSize: 32, color: colors.onSurface, marginTop: 4, letterSpacing: -0.3 },
  deltaLine: { fontFamily: fonts.mono, fontSize: 14, marginTop: 4 },
  pricesAsOf: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: spacing.sm },
  priceWarning: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative, marginTop: 4 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  statsScroll: { marginBottom: spacing.lg, marginHorizontal: -spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  statCard: {
    minWidth: 150, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md,
  },
  // Grid variant: fills the row in even columns instead of a fixed width
  // tuned for a horizontal-scroll strip.
  statCardGrid: { minWidth: 200, flexBasis: 200, flexGrow: 1 },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 22, color: colors.onSurface },
  statSublabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 },
  yieldCard: {
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  yieldCardHeader: { marginBottom: spacing.sm },
  yieldCardTitle: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.5 },
  allocationBar: {
    flexDirection: 'row', height: 12, borderRadius: radii.full, overflow: 'hidden',
    backgroundColor: colors.surfaceContainerHighest, marginBottom: spacing.md,
  },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '45%' },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginBottom: spacing.md },
  bucketChipsLabel: { marginTop: spacing.sm, marginBottom: 6 },
  bucketChipsLabelText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  bucketChipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bucketChip: {
    minWidth: '45%', flexGrow: 1, backgroundColor: colors.surfaceContainerHighest, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.default, padding: spacing.xs,
  },
  bucketChipLabel: { fontFamily: fonts.bodyBold, fontSize: 10, textTransform: 'uppercase', marginBottom: 2 },
  bucketChipValue: { fontFamily: fonts.mono, fontSize: 12, color: colors.onSurface },
  bucketSuggestion: {
    marginTop: spacing.md, backgroundColor: colors.surfaceContainerHighest, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.default, padding: spacing.sm,
  },
});
