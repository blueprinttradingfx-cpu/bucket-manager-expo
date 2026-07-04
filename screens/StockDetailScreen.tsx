// screens/StockDetailScreen.tsx
// Level 3 of the drill-down: one ticker, merged across every bucket that
// holds it. Restyled to match the Stitch design system (see
// DashboardScreen for the full rationale). Includes live valuation
// (market value, unrealized gain, current yield) when the price cache is
// reachable - degrades gracefully to cost-basis-only otherwise. The
// "Held In" list uses the same Positions table component as the other two
// screens, just with rows keyed by bucket instead of ticker.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, ValuedAggregatedStock, ValuedStockPosition, BucketStockPosition, applyPricesToAggregated, computePortfolioValuation } from '../core/bucketLogic';
import { fetchPriceCache } from '../core/priceCache';
import { DashboardStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts } from '../core/theme';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';

type Props = NativeStackScreenProps<DashboardStackParamList, 'StockDetail'>;

type BucketPositionRow = ValuedStockPosition | BucketStockPosition;

function isValuedPosition(p: BucketPositionRow): p is ValuedStockPosition {
  return 'marketValue' in p;
}

function toPositionItem(item: BucketPositionRow): PositionItem {
  const valued = isValuedPosition(item) ? item : null;
  return {
    key: item.bucket,
    label: item.bucket,
    badgeText: item.bucket.slice(0, 2).toUpperCase(),
    badgeVariant: 'neutral',
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

export default function StockDetailScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
  useScreenViewLog('StockDetail', { ticker });
  const store = useStore();
  const [stock, setStock] = useState<AggregatedStock | ValuedAggregatedStock | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const all = await store.getAggregatedStocks();
      const found = all.find((s) => s.ticker === ticker) ?? null;
      try {
        const prices = await fetchPriceCache();
        const valued = found ? applyPricesToAggregated([found], prices.tickers)[0] : null;
        setStock(valued);
      } catch (e: any) {
        console.log('[StockDetail] price cache unavailable:', e.message);
        setStock(found);
      }
      setLoading(false);
    })();
  }, [store, ticker]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!stock) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No holdings found for {ticker}.</Text>
      </View>
    );
  }

  const valued = 'marketValue' in stock ? (stock as ValuedAggregatedStock) : null;
  const heldIn = stock.buckets.map(toPositionItem);
  const valuation = valued
    ? computePortfolioValuation(stock.buckets as ValuedStockPosition[], stock.totalDividends, stock.totalCostBasis)
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.ticker}>{stock.ticker}</Text>
      <Text style={styles.subtitle}>Across {stock.buckets.length} bucket{stock.buckets.length === 1 ? '' : 's'}</Text>

      <View style={styles.statsRow}>
        <Stat label="Total Shares" value={String(stock.totalQty)} />
        <Stat label="Blended Avg Cost" value={`₱${stock.avgCost}`} />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label={valued?.marketValue != null ? 'Market Value' : 'Total Cost Basis'}
          value={`₱${(valued?.marketValue ?? stock.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          big
        />
        <Stat label="Total Dividends" value={`₱${stock.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big sign="positive" />
      </View>
      {valuation && (
        <View style={styles.statsRow}>
          <Stat
            label="Unrealized Gain"
            value={`${valuation.totalUnrealizedGain >= 0 ? '+' : ''}₱${valuation.totalUnrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valuation.totalUnrealizedGainPct >= 0 ? '+' : ''}${valuation.totalUnrealizedGainPct}%`}
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
      {valued?.currentPrice != null && (
        <Text style={styles.priceLine}>
          current price ₱{valued.currentPrice}
          {valued.currentYieldPct != null ? ` · yield ${valued.currentYieldPct}%` : ''}
        </Text>
      )}

      <Text style={styles.positionsHeader}>Held In</Text>
      <PositionsTable
        items={heldIn}
        onItemPress={(bucket) => navigation.navigate('StockInBucket', { bucket, ticker: stock.ticker })}
        emptyText="Not currently held in any bucket."
      />
    </ScrollView>
  );
}

function Stat({ label, value, big, sign, sublabel }: { label: string; value: string; big?: boolean; sign?: 'positive' | 'negative'; sublabel?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statValueBig, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  ticker: { fontFamily: fonts.monoBold, fontSize: 26, color: colors.onBackground },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.xl, padding: spacing.md },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 16, color: colors.onSurface },
  statValueBig: { fontSize: 20 },
  statSublabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  priceLine: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.xs, marginBottom: spacing.md },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
});
