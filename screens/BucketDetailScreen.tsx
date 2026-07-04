// screens/BucketDetailScreen.tsx
// Level 2 of the drill-down: everything held within ONE specific bucket,
// with dividends now included per stock (this is what the flat, repeated
// B2/B3/B4 list in the original screenshot was missing insight from).
// Tapping a stock goes deeper, to StockInBucketScreen.

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { BucketStockPosition } from '../core/bucketLogic';
import { BucketsStackParamList } from '../core/navigationTypes';

type Props = NativeStackScreenProps<BucketsStackParamList, 'BucketDetail'>;

export default function BucketDetailScreen({ route, navigation }: Props) {
  const { bucket } = route.params;
  const store = useStore();
  const [positions, setPositions] = useState<BucketStockPosition[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const p = await store.getBucketPositions(bucket);
    setPositions([...p].sort((a, b) => b.totalCostBasis - a.totalCostBasis));
  }, [store, bucket]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const totalCost = positions.reduce((s, p) => s + p.totalCostBasis, 0);
  const totalDiv = positions.reduce((s, p) => s + p.totalDividends, 0);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{bucket}</Text>
      <View style={styles.statsRow}>
        <Stat label="Cost Basis" value={`₱${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Stat label="Dividends Earned" value={`₱${totalDiv.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} highlight />
      </View>

      <FlatList
        data={positions}
        keyExtractor={(p) => p.ticker}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94a3b8" />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('StockInBucket', { bucket, ticker: item.ticker })}
          >
            <View>
              <Text style={styles.ticker}>{item.ticker}</Text>
              <Text style={styles.meta}>{item.openLots} lot{item.openLots === 1 ? '' : 's'} · {item.totalQty} sh · avg ₱{item.avgCost}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.cost}>₱{item.totalCostBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
              {item.totalDividends > 0 && (
                <Text style={styles.div}>+₱{item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })} div</Text>
              )}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No holdings in this bucket yet. Import a statement to get started.</Text>}
      />
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0f172a' },
  header: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12 },
  statLabel: { color: '#64748b', fontSize: 12 },
  statValue: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginTop: 4 },
  statValueHighlight: { color: '#4ade80' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  ticker: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  meta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  cost: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  div: { color: '#4ade80', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 40 },
});
