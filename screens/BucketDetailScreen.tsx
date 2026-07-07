// screens/BucketDetailScreen.tsx
// Level 2 of the drill-down: everything held within ONE specific bucket.
// Restyled to match the Stitch design system (see DashboardScreen for
// the full rationale) - same Positions table, stat cards, theme tokens.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { BucketStockPosition, ValuedStockPosition, applyPricesToPositions, computePortfolioValuation, PortfolioValuation, sumMarketValue, monthlyDividendTotals } from '../core/bucketLogic';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { BucketsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts } from '../core/theme';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import MonthlyDividendChart from './components/MonthlyDividendChart';

type Props = NativeStackScreenProps<BucketsStackParamList, 'BucketDetail'>;

type PositionRow = ValuedStockPosition | BucketStockPosition;

function isValued(p: PositionRow): p is ValuedStockPosition {
  return 'marketValue' in p;
}

function toPositionItem(item: PositionRow): PositionItem {
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
        <ExpandedRow label="Open Lots" value={String(item.openLots)} />
        <ExpandedRow label="Dividends Earned" value={`₱${item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} valueStyle={item.totalDividends > 0 ? { color: colors.positive } : undefined} />
        {item.pendingSettlement && (
          <ExpandedRow label="Status" value="Awaiting NAVPU from statement" />
        )}
      </>
    ),
  };
}

export default function BucketDetailScreen({ route, navigation }: Props) {
  const { bucket } = route.params;
  useScreenViewLog('BucketDetail', { bucket });
  const store = useStore();
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricesAvailable, setPricesAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'stock' | 'fund'>('all');
  const [totalRealizedGain, setTotalRealizedGain] = useState(0);
  const [totalDividends, setTotalDividends] = useState(0);
  const [txnHistoryOpen, setTxnHistoryOpen] = useState(false);
  const [transactionFeed, setTransactionFeed] = useState<
    { date: string; type: string; ticker: string; quantity: number | null; price: number | null; amount: number | null }[]
  >([]);

  const load = useCallback(async (forcePrices = false) => {
    const [p, lifetime, feed] = await Promise.all([
      store.getBucketPositions(bucket),
      store.getBucketLifetimeTotals(bucket),
      store.getBucketTransactionFeed(bucket),
    ]);
    setTotalRealizedGain(lifetime.totalRealizedGain);
    setTotalDividends(lifetime.totalDividends);
    setTransactionFeed(feed);
    try {
      const prices = await fetchPriceCache(undefined, { force: forcePrices });
      setPriceCache(prices);
      setPriceError(null);
      setPricesAvailable(true);
      setPositions(applyPricesToPositions(p, prices.tickers));
    } catch (e: any) {
      console.log('[BucketDetail] price cache unavailable:', e.message);
      setPriceError(e.message);
      setPricesAvailable(false);
      setPositions(p);
    }
  }, [store, bucket]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  // All asset types combined - this is now literally the "Total Investment"
  // headline below: total money committed, stocks + funds, at cost. Not a
  // market value at all (deliberately - see stocksOnlyValuation below for
  // the price-backed gain/loss figure that goes with it).
  const totalCost = positions.reduce((s, p) => s + p.totalCostBasis, 0);
  // Stock-only cost basis for the "Stocks Total Portfolio Cost" stat -
  // deliberately excludes funds (and, like totalCost, excludes Dividends
  // Earned/Realized G/L entirely - those are separate stats and DragonFi
  // treats them as cash, not invested capital).
  const stocksCostBasis = positions.filter((p) => p.assetType === 'stock').reduce((s, p) => s + p.totalCostBasis, 0);
  // Fund-only cost basis for "Funds Total Portfolio Cost". There's no
  // matching fund market-value figure - funds have no live price feed - so
  // "Funds Total Portfolio Value" is surfaced as an explicit N/A instead.
  const fundsCostBasis = positions.filter((p) => p.assetType === 'fund').reduce((s, p) => s + p.totalCostBasis, 0);
  const valuation: PortfolioValuation | null = useMemo(
    () => (pricesAvailable ? computePortfolioValuation(positions as ValuedStockPosition[], totalDividends, totalCost, totalRealizedGain) : null),
    [positions, pricesAvailable, totalDividends, totalCost, totalRealizedGain]
  );
  // Stocks Total Portfolio Value - market value of stock-type holdings only.
  const stocksValueInfo = useMemo(
    () => (pricesAvailable ? sumMarketValue(positions as ValuedStockPosition[], 'stock') : null),
    [positions, pricesAvailable]
  );
  // Scoped unrealized-gain delta shown under "Total Investment" - stock-only
  // since funds have no live price feed (so no fund-side unrealized gain can
  // be computed; it's simply omitted rather than assumed 0). This is the
  // bucket's real, price-backed unrealized gain.
  const stocksOnlyValuation = useMemo(
    () => (pricesAvailable
      ? computePortfolioValuation(positions.filter((p) => p.assetType === 'stock') as ValuedStockPosition[], 0, stocksCostBasis, 0)
      : null),
    [positions, pricesAvailable, stocksCostBasis]
  );
  const stockCount = useMemo(() => positions.filter((p) => p.assetType === 'stock').length, [positions]);
  const fundCount = useMemo(() => positions.filter((p) => p.assetType === 'fund').length, [positions]);
  const visible = useMemo(
    () => (activeTab === 'all' ? positions : positions.filter((p) => p.assetType === activeTab)).map(toPositionItem),
    [positions, activeTab]
  );
  const currentYear = new Date().getFullYear();
  // Reuses the already-loaded transaction feed rather than a second
  // store call - it already carries every CASH DIVIDEND row for this
  // bucket, dated, which is all monthlyDividendTotals needs.
  const monthlyDividends = useMemo(
    () => monthlyDividendTotals(
      transactionFeed.filter((t) => t.type === 'CASH DIVIDEND').map((t) => ({ date: t.date, amount: t.amount ?? 0 })),
      currentYear
    ),
    [transactionFeed, currentYear]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.header}>{bucket}</Text>

      <View style={styles.marketValueBlock}>
        <Text style={styles.caption}>Total Investment</Text>
        <Text style={styles.marketValue}>
          ₱{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </Text>
        {stocksOnlyValuation && (
          <Text style={[styles.deltaLine, stocksOnlyValuation.totalUnrealizedGain >= 0 ? styles.positive : styles.negative]}>
            {stocksOnlyValuation.totalUnrealizedGain >= 0 ? '↑' : '↓'} ₱{Math.abs(stocksOnlyValuation.totalUnrealizedGain).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {' '}({stocksOnlyValuation.totalUnrealizedGainPct >= 0 ? '+' : ''}{stocksOnlyValuation.totalUnrealizedGainPct}%) unrealized on stocks
          </Text>
        )}
      </View>

      <View style={styles.statsRow}>
        <Stat label="Stocks Total Portfolio Cost" value={`₱${stocksCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Stat
          label="Stocks Total Portfolio Value"
          value={stocksValueInfo ? `₱${stocksValueInfo.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
          sublabel={stocksValueInfo && stocksValueInfo.unpricedCount > 0 ? `${stocksValueInfo.unpricedCount} unpriced` : undefined}
        />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Funds Total Portfolio Cost" value={`₱${fundsCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Stat label="Funds Total Portfolio Value" value="N/A" sublabel="no live fund pricing yet" />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Dividends Earned" value={`₱${totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} sign="positive" />
        <Stat
          label="Realized G/L"
          value={`${totalRealizedGain >= 0 ? '+' : ''}₱${totalRealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          sublabel="from closed positions"
          sign={totalRealizedGain >= 0 ? 'positive' : 'negative'}
        />
      </View>
      {valuation && (
        <View style={styles.statsRow}>
          <Stat
            label="Unrealized Gain"
            value={`${valuation.totalUnrealizedGain >= 0 ? '+' : ''}₱${valuation.totalUnrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valuation.totalUnrealizedGainPct >= 0 ? '+' : ''}${valuation.totalUnrealizedGainPct}%${valuation.unpricedTickers > 0 ? ` · ${valuation.unpricedTickers} unpriced` : ''}`}
            sign={valuation.totalUnrealizedGain >= 0 ? 'positive' : 'negative'}
          />
          <Stat
            label="Total Return"
            value={`${valuation.totalReturn >= 0 ? '+' : ''}₱${valuation.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gains)`}
            sign={valuation.totalReturn >= 0 ? 'positive' : 'negative'}
          />
        </View>
      )}


      {priceError && <Text style={styles.priceWarning}>Live prices unavailable - can't show unrealized gain/loss right now.</Text>}
      {priceCache && <Text style={styles.priceFreshness}>Prices as of {new Date(priceCache.generatedAt).toLocaleString()}</Text>}

      <MonthlyDividendChart
        year={currentYear}
        monthlyTotals={monthlyDividends}
        onViewAll={() => navigation.navigate('MonthlyDividendIncome', { bucket })}
      />

      <Text style={styles.positionsHeader}>Positions</Text>

      <PositionsTable
        items={visible}
        onItemPress={(ticker) => navigation.navigate('StockInBucket', { bucket, ticker })}
        tabs={[
          { key: 'all', label: 'All', count: positions.length },
          { key: 'stock', label: 'Stocks', count: stockCount },
          { key: 'fund', label: 'Funds', count: fundCount },
        ]}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as 'all' | 'stock' | 'fund')}
        emptyText={positions.length === 0 ? 'No holdings in this bucket yet. Import a statement to get started.' : `No ${activeTab === 'fund' ? 'funds' : 'stocks'} in this view.`}
      />

      <Pressable style={styles.accordionHeader} onPress={() => setTxnHistoryOpen((o) => !o)}>
        <Text style={styles.positionsHeader}>Transaction History{transactionFeed.length > 0 ? ` (${transactionFeed.length})` : ''}</Text>
        <Text style={styles.accordionChevron}>{txnHistoryOpen ? '︿' : '⌄'}</Text>
      </Pressable>
      {txnHistoryOpen && (
        transactionFeed.length === 0 ? (
          <Text style={styles.emptyFeedText}>No transactions in this bucket yet.</Text>
        ) : (
          transactionFeed.map((txn, i) => (
            <View key={i} style={styles.txnRow}>
              <View style={styles.txnLeft}>
                <Text style={[styles.txnType, txn.type === 'BUY' ? styles.positive : txn.type === 'SELL' ? styles.negative : styles.dividend]}>
                  {txn.type}
                </Text>
                <Text style={styles.txnStock}>{txn.ticker}</Text>
                <Text style={styles.txnDate}>{txn.date}</Text>
              </View>
              <View style={styles.txnRight}>
                {txn.quantity != null && <Text style={styles.txnDetail}>{txn.quantity.toLocaleString()} sh</Text>}
                {txn.price != null && <Text style={styles.txnDetail}>@ ₱{txn.price}</Text>}
                {txn.amount != null && <Text style={styles.txnDetail}>₱{txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>}
              </View>
            </View>
          ))
        )
      )}
    </ScrollView>
  );
}

function Stat({ label, value, sublabel, sign }: { label: string; value: string; sublabel?: string; sign?: 'positive' | 'negative' }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: spacing.md },
  marketValueBlock: { marginBottom: spacing.lg },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  marketValue: { fontFamily: fonts.bodySemiBold, fontSize: 32, color: colors.onSurface, marginTop: 4, letterSpacing: -0.3 },
  deltaLine: { fontFamily: fonts.mono, fontSize: 14, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.xl, padding: spacing.md },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 18, color: colors.onSurface },
  statSublabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  priceWarning: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.negative, marginBottom: 4 },
  priceFreshness: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginBottom: 4 },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.md, marginBottom: spacing.md },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accordionChevron: { fontFamily: fonts.body, fontSize: 20, color: colors.onSurfaceVariant, marginTop: spacing.md, marginBottom: spacing.md, paddingHorizontal: spacing.sm },
  emptyFeedText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  dividend: { color: colors.primary },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.base,
  },
  txnLeft: { flex: 1 },
  txnType: { fontFamily: fonts.monoBold, fontSize: 11, textTransform: 'uppercase', marginBottom: 2 },
  txnStock: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  txnDate: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  txnRight: { alignItems: 'flex-end' },
  txnDetail: { fontFamily: fonts.mono, fontSize: 12, color: colors.onSurfaceVariant },
});
