// screens/DashboardScreen.tsx
// Level 1: the main aggregated dashboard. Portfolio totals + one row per
// TICKER merged across buckets. Now also layers in live price/yield data
// from the GitHub Actions price-cache pipeline where available - market
// value, unrealized gain/loss, current yield. Gracefully degrades to
// cost-basis-only if the price cache can't be reached (e.g. placeholder
// URL not yet configured, or offline) - never blocks the core view on it.

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, PortfolioSummary, ValuedAggregatedStock, applyPricesToAggregated, computePortfolioValuation, PortfolioValuation } from '../core/bucketLogic';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { DashboardStackParamList } from '../core/navigationTypes';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>;

export default function DashboardScreen({ navigation }: Props) {
  const store = useStore();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [stocks, setStocks] = useState<ValuedAggregatedStock[] | AggregatedStock[]>([]);
  const [valuation, setValuation] = useState<PortfolioValuation | null>(null);
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (forcePrices = false) => {
    const [s, a] = await Promise.all([store.getPortfolioSummary(), store.getAggregatedStocks()]);
    setSummary(s);

    try {
      const prices = await fetchPriceCache(undefined, { force: forcePrices });
      setPriceCache(prices);
      setPriceError(null);
      const valued = applyPricesToAggregated(a, prices.tickers);
      setStocks(valued);
      const flatPositions = valued.flatMap((v) => v.buckets);
      setValuation(computePortfolioValuation(flatPositions, s.totalDividends, s.totalCostBasis));
    } catch (e: any) {
      // Expected until the price cache URL is configured to a real repo -
      // don't block the dashboard on it, just show cost-basis-only.
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

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Dashboard</Text>

      {summary && (
        <>
          <Text style={styles.totalLabel}>{valuation ? 'Market Value' : 'Total Cost Basis'}</Text>
          <Text style={styles.total}>
            ₱{(valuation ? valuation.totalMarketValue : summary.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </Text>
          {valuation && (
            <Text style={[styles.gainLine, valuation.totalUnrealizedGain >= 0 ? styles.gainPositive : styles.gainNegative]}>
              {valuation.totalUnrealizedGain >= 0 ? '+' : ''}₱{valuation.totalUnrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              {' '}({valuation.totalUnrealizedGainPct >= 0 ? '+' : ''}{valuation.totalUnrealizedGainPct}%) unrealized
              {valuation.unpricedTickers > 0 ? ` · ${valuation.unpricedTickers} unpriced` : ''}
            </Text>
          )}

          <View style={styles.statsRow}>
            <MiniStat
              label="Dividends Earned"
              value={`₱${summary.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              sublabel={`${summary.realizedDividendYieldPct}% of cost`}
              highlight
            />
            <MiniStat label="Stocks" value={String(summary.stockCount)} />
            <MiniStat label="Buckets" value={String(summary.bucketCount)} />
          </View>

          {valuation && (
            <View style={styles.statsRow}>
              <MiniStat
                label="Total Return"
                value={`${valuation.totalReturn >= 0 ? '+' : ''}₱${valuation.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gain)`}
                highlight={valuation.totalReturn >= 0}
              />
            </View>
          )}

          {priceError && (
            <Text style={styles.priceWarning}>
              Live prices unavailable - showing cost basis only. {priceError.includes('YOUR_USERNAME') ? 'Configure DEFAULT_PRICE_CACHE_URL in core/priceCache.ts once your repo is on GitHub.' : ''}
            </Text>
          )}
          {priceCache && (
            <Text style={styles.priceFreshness}>Prices as of {new Date(priceCache.generatedAt).toLocaleString()}</Text>
          )}

          {summary.byBucket.length > 0 && (
            <View style={styles.allocationBar}>
              {summary.byBucket.map((b, i) => (
                <View
                  key={b.bucket}
                  style={{
                    flex: b.percentage,
                    backgroundColor: BUCKET_COLORS[i % BUCKET_COLORS.length],
                    height: '100%',
                  }}
                />
              ))}
            </View>
          )}
          <View style={styles.legendRow}>
            {summary.byBucket.map((b, i) => (
              <Text key={b.bucket} style={styles.legendItem}>
                <Text style={{ color: BUCKET_COLORS[i % BUCKET_COLORS.length] }}>●</Text> {b.bucket} {b.percentage}%
              </Text>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionHeader}>Holdings (all buckets combined)</Text>
      <FlatList
        data={stocks}
        keyExtractor={(s) => s.ticker}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94a3b8" />}
        renderItem={({ item }) => {
          const valued = 'marketValue' in item ? (item as ValuedAggregatedStock) : null;
          return (
            <Pressable style={styles.stockRow} onPress={() => navigation.navigate('StockDetail', { ticker: item.ticker })}>
              <View>
                <Text style={styles.ticker}>{item.ticker}</Text>
                <Text style={styles.meta}>
                  {item.totalQty} sh across {item.buckets.length} bucket{item.buckets.length === 1 ? '' : 's'} · avg ₱{item.avgCost}
                </Text>
                {valued?.currentYieldPct != null && (
                  <Text style={styles.yieldMeta}>current yield {valued.currentYieldPct}%</Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cost}>
                  ₱{(valued?.marketValue ?? item.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </Text>
                {valued?.unrealizedGain != null && (
                  <Text style={[styles.gainSmall, valued.unrealizedGain >= 0 ? styles.gainPositive : styles.gainNegative]}>
                    {valued.unrealizedGain >= 0 ? '+' : ''}{valued.unrealizedGainPct}%
                  </Text>
                )}
                {item.totalDividends > 0 && (
                  <Text style={styles.div}>+₱{item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })} div</Text>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No holdings yet. Import a statement to get started.</Text>}
      />
    </View>
  );
}

function MiniStat({ label, value, sublabel, highlight }: { label: string; value: string; sublabel?: string; highlight?: boolean }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={[styles.miniStatValue, highlight && styles.miniStatHighlight]}>{value}</Text>
      {sublabel && <Text style={styles.miniStatSublabel}>{sublabel}</Text>}
    </View>
  );
}

const BUCKET_COLORS = ['#38bdf8', '#a78bfa', '#4ade80', '#fb923c', '#f472b6', '#facc15'];

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0f172a' },
  header: { fontSize: 22, fontWeight: '700', color: '#f1f5f9' },
  totalLabel: { color: '#94a3b8', fontSize: 13, marginTop: 12 },
  total: { color: '#f1f5f9', fontSize: 30, fontWeight: '800' },
  gainLine: { fontSize: 13, fontWeight: '600', marginTop: 2, marginBottom: 10 },
  gainPositive: { color: '#4ade80' },
  gainNegative: { color: '#f87171' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  miniStat: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 10 },
  miniStatLabel: { color: '#64748b', fontSize: 11 },
  miniStatValue: { color: '#f1f5f9', fontSize: 15, fontWeight: '700', marginTop: 2 },
  miniStatHighlight: { color: '#4ade80' },
  miniStatSublabel: { color: '#4ade80', fontSize: 10, marginTop: 1 },
  priceWarning: { color: '#fb923c', fontSize: 11, marginBottom: 8 },
  priceFreshness: { color: '#64748b', fontSize: 11, marginBottom: 8 },
  allocationBar: {
    flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden',
    backgroundColor: '#1e293b', marginTop: 4,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginBottom: 4, gap: 12 },
  legendItem: { color: '#94a3b8', fontSize: 12 },
  sectionHeader: { color: '#94a3b8', fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  stockRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  ticker: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  meta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  yieldMeta: { color: '#38bdf8', fontSize: 11, marginTop: 2 },
  cost: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  gainSmall: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  div: { color: '#4ade80', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 40 },
});
