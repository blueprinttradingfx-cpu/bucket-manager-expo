// screens/DashboardScreen.tsx
// Level 1: the main aggregated dashboard. Restyled to match the Stitch
// design export (stitch_bucket_portfolio_design_system[_mobile].zip) -
// light "Fintech Terminal" theme, Inter + JetBrains Mono, stat card row,
// and a "Yield Distribution" bar using the real per-bucket colors from
// core/theme's bucketColorFor (falls back to a neutral palette for bucket
// names that don't follow the B1-B5 convention).
//
// Portfolio totals + one row per TICKER merged across buckets. Layers in
// live price/yield data from the GitHub Actions price-cache pipeline
// where available - market value, unrealized gain/loss, current yield.
// Gracefully degrades to cost-basis-only if the price cache can't be
// reached - never blocks the core view on it.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, PortfolioSummary, ValuedAggregatedStock, applyPricesToAggregated, computePortfolioValuation, PortfolioValuation, sumMarketValue, YieldBracket, DividendPayment, monthlyDividendTotals, averageMonthlyDividendIncome } from '../core/bucketLogic';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { DashboardStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts, bucketColorFor } from '../core/theme';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import BucketSuggestion from './components/BucketSuggestion';
import MonthlyDividendChart from './components/MonthlyDividendChart';
import PassiveIncomeGoalCard from './components/PassiveIncomeGoalCard';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>;

type StockRow = ValuedAggregatedStock | AggregatedStock;

function isValued(s: StockRow): s is ValuedAggregatedStock {
  return 'marketValue' in s;
}

function toPositionItem(item: StockRow, yieldBuckets: YieldBracket[]): PositionItem {
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

export default function DashboardScreen({ navigation }: Props) {
  useScreenViewLog('Dashboard');
  const store = useStore();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [yieldBuckets, setYieldBuckets] = useState<YieldBracket[]>([]);
  const [dividendFeed, setDividendFeed] = useState<DividendPayment[]>([]);
  const [monthlyGoal, setMonthlyGoal] = useState<number | null>(null);
  const [valuation, setValuation] = useState<PortfolioValuation | null>(null);
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
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

    try {
      const prices = await fetchPriceCache(undefined, { force: forcePrices });
      setPriceCache(prices);
      setPriceError(null);
      const valued = applyPricesToAggregated(a, prices.tickers);
      setStocks(valued);
      const flatPositions = valued.flatMap((v) => v.buckets);
      setValuation(computePortfolioValuation(flatPositions, s.totalDividends, s.totalCostBasis, s.totalRealizedGain));
    } catch (e: any) {
      console.log('[Dashboard] price cache unavailable:', e.message);
      setPriceError(e.message);
      setStocks(a);
      setValuation(null);
    }
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
  // Funds have no live price feed (priceCache only covers PSE stock tickers),
  // so there's no equivalent fund market value to compute yet - see
  // "Funds Total Portfolio Value" stat below, shown as N/A for now.
  const stocksValueInfo = useMemo(
    () => (valuation ? sumMarketValue(stocks as ValuedAggregatedStock[], 'stock') : null),
    [stocks, valuation]
  );
  // Scoped unrealized-gain delta shown under the "Total Investment" headline -
  // stock-only since funds have no live price feed (so no fund-side
  // unrealized gain can be computed - it's simply omitted rather than
  // assumed 0). This is the portfolio's real, price-backed unrealized gain.
  const stocksOnlyValuation = useMemo(() => {
    if (!valuation || !summary) return null;
    const valuedStockBuckets = (stocks as ValuedAggregatedStock[])
      .filter((s) => s.assetType === 'stock')
      .flatMap((s) => s.buckets);
    return computePortfolioValuation(valuedStockBuckets, 0, summary.stocksCostBasis, 0);
  }, [stocks, valuation, summary]);
  const visible = useMemo(
    () => (activeTab === 'all' ? stocks : stocks.filter((s) => s.assetType === activeTab)).map((item) => toPositionItem(item, yieldBuckets)),
    [stocks, activeTab, yieldBuckets]
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
            {priceCache && <Text style={styles.pricesAsOf}>Prices as of {new Date(priceCache.generatedAt).toLocaleString()}</Text>}
            {priceError && <Text style={styles.priceWarning}>Live prices unavailable - can't show unrealized gain/loss right now.</Text>}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll} contentContainerStyle={styles.statsRow}>
            <StatCard label="Stocks Total Portfolio Cost" value={`₱${summary.stocksCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
            <StatCard
              label="Stocks Total Portfolio Value"
              value={stocksValueInfo ? `₱${stocksValueInfo.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
              sublabel={stocksValueInfo && stocksValueInfo.unpricedCount > 0 ? `${stocksValueInfo.unpricedCount} unpriced` : undefined}
            />
            <StatCard label="Funds Total Portfolio Cost" value={`₱${summary.fundsCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
            <StatCard label="Funds Total Portfolio Value" value="N/A" sublabel="no live fund pricing yet" />
            <StatCard label="Dividends Earned" value={`₱${summary.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} sublabel={`${summary.realizedDividendYieldPct}% of cost`} sign="positive" />
            <StatCard
              label="Realized Gain/Loss"
              value={`${summary.totalRealizedGain >= 0 ? '+' : ''}₱${summary.totalRealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              sublabel="from closed positions"
              sign={summary.totalRealizedGain >= 0 ? 'positive' : 'negative'}
            />
            <StatCard label="Stocks" value={String(summary.stockCount)} sublabel="Active Positions" />
            <StatCard label="Buckets" value={String(summary.bucketCount)} sublabel="Active Accounts" />
            {valuation && (
              <StatCard
                label="Total Return"
                value={`₱${valuation.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gains)`}
                sign={valuation.totalReturn >= 0 ? 'positive' : 'negative'}
              />
            )}
          </ScrollView>

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

function StatCard({ label, value, sublabel, sign }: { label: string; value: string; sublabel?: string; sign?: 'positive' | 'negative' }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  statCard: {
    minWidth: 150, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md,
  },
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
