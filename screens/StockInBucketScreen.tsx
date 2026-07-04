// screens/StockInBucketScreen.tsx
// Level 4 of the drill-down: one ticker, within one bucket, specifically.
// The most granular view - individual lots' worth (via the position summary)
// plus the actual dividend payment history for this ticker in this bucket.
// Reached from both BucketDetailScreen (tap a stock) and StockDetailScreen
// (tap a bucket within a stock's cross-bucket breakdown) - same screen,
// registered in both stacks.

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useStore } from '../core/StoreProvider';
import { BucketStockPosition } from '../core/bucketLogic';

// Minimal structural prop type, not tied to either stack's specific
// NativeStackScreenProps - this screen is registered in BOTH
// DashboardStack and BucketsStack (reachable via two different drill-down
// paths), and only ever reads route.params, never calls navigation.navigate,
// so it doesn't need either stack's specific navigation type.
interface Props {
  route: { params: { bucket: string; ticker: string } };
}

export default function StockInBucketScreen({ route }: Props) {
  const { bucket, ticker } = route.params;
  const store = useStore();
  const [position, setPosition] = useState<BucketStockPosition | null>(null);
  const [dividends, setDividends] = useState<{ date: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [positions, divHistory] = await Promise.all([
        store.getBucketPositions(bucket),
        store.getDividendHistory(bucket, ticker),
      ]);
      setPosition(positions.find((p) => p.ticker === ticker) ?? null);
      setDividends(divHistory);
      setLoading(false);
    })();
  }, [store, bucket, ticker]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (!position) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No current position for {ticker} in {bucket}.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.ticker}>{ticker}</Text>
      <Text style={styles.bucketLabel}>{bucket}</Text>

      <View style={styles.statsRow}>
        <Stat label="Shares" value={String(position.totalQty)} />
        <Stat label="Avg Cost" value={`₱${position.avgCost}`} />
        <Stat label="Lots" value={String(position.openLots)} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Cost Basis" value={`₱${position.totalCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big />
        <Stat label="Dividends Earned" value={`₱${position.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big highlight />
      </View>

      <Text style={styles.sectionHeader}>Dividend History</Text>
      <FlatList
        data={dividends}
        keyExtractor={(d, i) => `${d.date}-${i}`}
        renderItem={({ item }) => (
          <View style={styles.divRow}>
            <Text style={styles.divDate}>{item.date}</Text>
            <Text style={styles.divAmount}>₱{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No dividend payments recorded yet for this ticker in this bucket.</Text>}
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
  bucketLabel: { fontSize: 14, color: '#38bdf8', fontWeight: '600', marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12 },
  statLabel: { color: '#64748b', fontSize: 12 },
  statValue: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginTop: 4 },
  statValueBig: { fontSize: 20 },
  statValueHighlight: { color: '#4ade80' },
  sectionHeader: { color: '#94a3b8', fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 8, textTransform: 'uppercase' },
  divRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#1e293b', borderRadius: 8, padding: 12, marginBottom: 6,
  },
  divDate: { color: '#94a3b8' },
  divAmount: { color: '#4ade80', fontWeight: '700' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
});
