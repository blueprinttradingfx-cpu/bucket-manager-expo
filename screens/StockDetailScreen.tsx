// screens/StockDetailScreen.tsx
// Level 3 of the drill-down: one ticker, merged across every bucket that
// holds it. Now includes live valuation (market value, unrealized gain,
// current yield) when the price cache is reachable - degrades gracefully
// to cost-basis-only otherwise, same pattern as DashboardScreen.

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, ValuedAggregatedStock, applyPricesToAggregated } from '../core/bucketLogic';
import { fetchPriceCache } from '../core/priceCache';
import { DashboardStackParamList } from '../core/navigationTypes';

type Props = NativeStackScreenProps<DashboardStackParamList, 'StockDetail'>;

export default function StockDetailScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
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
        <ActivityIndicator color="#38bdf8" />
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

  return (
    <View style={styles.container}>
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
        <Stat label="Total Dividends" value={`₱${stock.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big highlight />
      </View>
      {valued?.unrealizedGain != null && (
        <Text style={[styles.gainLine, valued.unrealizedGain >= 0 ? styles.gainPositive : styles.gainNegative]}>
          {valued.unrealizedGain >= 0 ? '+' : ''}₱{valued.unrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          {' '}({valued.unrealizedGainPct! >= 0 ? '+' : ''}{valued.unrealizedGainPct}%) unrealized · current price ₱{valued.currentPrice}
          {valued.currentYieldPct != null ? ` · yield ${valued.currentYieldPct}%` : ''}
        </Text>
      )}

      <Text style={styles.sectionHeader}>Held In</Text>
      <FlatList
        data={stock.buckets}
        keyExtractor={(b) => b.bucket}
        renderItem={({ item }) => {
          const vItem = 'marketValue' in item ? (item as any) : null;
          return (
            <Pressable
              style={styles.bucketRow}
              onPress={() => navigation.navigate('StockInBucket', { bucket: item.bucket, ticker: stock.ticker })}
            >
              <View>
                <Text style={styles.bucketName}>{item.bucket}</Text>
                <Text style={styles.bucketMeta}>{item.totalQty} sh · {item.openLots} lot{item.openLots === 1 ? '' : 's'} · avg ₱{item.avgCost}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.bucketCost}>
                  ₱{(vItem?.marketValue ?? item.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </Text>
                {vItem?.unrealizedGainPct != null && (
                  <Text style={[styles.bucketGain, vItem.unrealizedGain >= 0 ? styles.gainPositive : styles.gainNegative]}>
                    {vItem.unrealizedGain >= 0 ? '+' : ''}{vItem.unrealizedGainPct}%
                  </Text>
                )}
                {item.totalDividends > 0 && (
                  <Text style={styles.bucketDiv}>+₱{item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })} div</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function Stat({ label, value, big, highlight }: { label: string; value: string; big?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statValueBig, highlight && styles.statValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0f172a' },
  center: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  ticker: { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12 },
  statLabel: { color: '#64748b', fontSize: 12 },
  statValue: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginTop: 4 },
  statValueBig: { fontSize: 20 },
  statValueHighlight: { color: '#4ade80' },
  gainLine: { fontSize: 12, fontWeight: '600', marginBottom: 12 },
  gainPositive: { color: '#4ade80' },
  gainNegative: { color: '#f87171' },
  sectionHeader: { color: '#94a3b8', fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 8, textTransform: 'uppercase' },
  bucketRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  bucketName: { color: '#38bdf8', fontSize: 15, fontWeight: '700' },
  bucketMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  bucketCost: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  bucketGain: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  bucketDiv: { color: '#4ade80', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
});
