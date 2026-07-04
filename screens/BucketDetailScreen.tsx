// screens/BucketDetailScreen.tsx
// Level 2 of the drill-down: everything held within ONE specific bucket.
// Restyled to match the Stitch design system (see DashboardScreen for
// the full rationale) - same Positions table, stat cards, theme tokens.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { BucketStockPosition, ValuedStockPosition, applyPricesToPositions, computePortfolioValuation, PortfolioValuation } from '../core/bucketLogic';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { BucketsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts } from '../core/theme';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';

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
    expandedContent: (
      <>
        <ExpandedRow label="Market Value" value={`₱${(valued?.marketValue ?? item.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <ExpandedRow label="Avg Cost" value={`₱${item.avgCost}`} />
        <ExpandedRow label="Open Lots" value={String(item.openLots)} />
        <ExpandedRow label="Dividends Earned" value={`₱${item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} valueStyle={item.totalDividends > 0 ? { color: colors.positive } : undefined} />
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

  const load = useCallback(async (forcePrices = false) => {
    const p = await store.getBucketPositions(bucket);
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

  const totalCost = positions.reduce((s, p) => s + p.totalCostBasis, 0);
  const totalDiv = positions.reduce((s, p) => s + p.totalDividends, 0);
  const valuation: PortfolioValuation | null = useMemo(
    () => (pricesAvailable ? computePortfolioValuation(positions as ValuedStockPosition[], totalDiv, totalCost) : null),
    [positions, pricesAvailable, totalDiv, totalCost]
  );
  const stockCount = useMemo(() => positions.filter((p) => p.assetType === 'stock').length, [positions]);
  const fundCount = useMemo(() => positions.filter((p) => p.assetType === 'fund').length, [positions]);
  const visible = useMemo(
    () => (activeTab === 'all' ? positions : positions.filter((p) => p.assetType === activeTab)).map(toPositionItem),
    [positions, activeTab]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.header}>{bucket}</Text>
      <View style={styles.statsRow}>
        <Stat label="Cost Basis" value={`₱${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Stat label="Dividends Earned" value={`₱${totalDiv.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} sign="positive" />
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
            sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gain)`}
            sign={valuation.totalReturn >= 0 ? 'positive' : 'negative'}
          />
        </View>
      )}

      {priceError && <Text style={styles.priceWarning}>Live prices unavailable - showing cost basis only.</Text>}
      {priceCache && <Text style={styles.priceFreshness}>Prices as of {new Date(priceCache.generatedAt).toLocaleString()}</Text>}

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
});
