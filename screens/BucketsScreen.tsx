// screens/BucketsScreen.tsx
// Configure buckets: name + yield bracket. This is the "bucket settings are
// configurable" requirement from scoping - no hardcoded count, add as many
// as you actually have DragonFi accounts for.
//
// Each bucket card now shows a real summary (stock count, cost basis,
// market value + unrealized gain, dividends earned) instead of just the
// name and yield range - the same stat-card language used on
// Dashboard/BucketDetail, so this screen actually tells you something
// about each bucket at a glance instead of being a settings-only list.

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, Modal } from 'react-native';
import Alert from '../core/alert';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../core/StoreProvider';
import { BucketRow } from '../core/storeApi';
import { applyPricesToPositions, sumMarketValue } from '../core/bucketLogic';
import { fetchPriceCache } from '../core/priceCache';
import { BucketsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts, bucketColorFor } from '../core/theme';

type Props = NativeStackScreenProps<BucketsStackParamList, 'BucketsHome'>;

interface BucketSummary {
  stockCount: number;
  costBasis: number;
  marketValue: number | null; // null when prices aren't available at all, not just unpriced tickers
  unpricedCount: number;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  dividends: number;
}

export default function BucketsScreen({ navigation }: Props) {
  useScreenViewLog('Buckets');
  const store = useStore();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [emptyBucketIds, setEmptyBucketIds] = useState<Set<number>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, BucketSummary>>({});
  const [priceError, setPriceError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const refresh = useCallback(async () => {
    const bucketList = await store.listBuckets();
    setBuckets(bucketList);

    // One shared price-cache fetch for every bucket, rather than one per
    // bucket - it's the same file regardless of which bucket asks for it.
    let priceTickers: Awaited<ReturnType<typeof fetchPriceCache>>['tickers'] | null = null;
    try {
      const cache = await fetchPriceCache();
      priceTickers = cache.tickers;
      setPriceError(null);
    } catch (e: any) {
      console.log('[Buckets] price cache unavailable:', e.message);
      setPriceError(e.message);
    }

    const results = await Promise.all(
      bucketList.map(async (bucket) => {
        try {
          const [holdings, positions, lifetime] = await Promise.all([
            store.getBucketHoldings(bucket.name),
            store.getBucketPositions(bucket.name),
            store.getBucketLifetimeTotals(bucket.name),
          ]);
          const isEmpty = holdings.holdings.length === 0 && holdings.orphanSells.length === 0;

          const costBasis = positions.reduce((s, p) => s + p.totalCostBasis, 0);
          let summary: BucketSummary;
          if (priceTickers) {
            const valued = applyPricesToPositions(positions, priceTickers);
            const { value, unpricedCount } = sumMarketValue(valued);
            const pricedCostBasis = valued.filter((p) => p.marketValue != null).reduce((s, p) => s + p.totalCostBasis, 0);
            const unrealizedGain = pricedCostBasis > 0 ? Math.round((value - pricedCostBasis) * 100) / 100 : null;
            const unrealizedGainPct = pricedCostBasis > 0 ? Math.round((unrealizedGain! / pricedCostBasis) * 10000) / 100 : null;
            summary = {
              stockCount: positions.length,
              costBasis,
              marketValue: value,
              unpricedCount,
              unrealizedGain,
              unrealizedGainPct,
              dividends: lifetime.totalDividends,
            };
          } else {
            summary = {
              stockCount: positions.length,
              costBasis,
              marketValue: null,
              unpricedCount: positions.length,
              unrealizedGain: null,
              unrealizedGainPct: null,
              dividends: lifetime.totalDividends,
            };
          }
          return { id: bucket.id, isEmpty: isEmpty ? bucket.id : null, summary };
        } catch (e) {
          // If we can't check holdings/positions, assume not empty to be
          // safe, and just omit the summary rather than blocking the list.
          return { id: bucket.id, isEmpty: null, summary: null };
        }
      })
    );

    setEmptyBucketIds(new Set(results.filter((r) => r.isEmpty !== null).map((r) => r.isEmpty!)));
    setSummaries(
      Object.fromEntries(
        results.filter((r) => r.summary !== null).map((r) => {
          const bucket = bucketList.find((b) => b.id === r.id)!;
          return [bucket.name, r.summary!];
        })
      )
    );
  }, [store]);

  // Refresh on every focus, not just mount - so renaming/adjusting a
  // bucket in EditBucketScreen and coming back shows the change
  // immediately instead of stale data until next app restart.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function addBucket() {
    const lowNum = parseFloat(low);
    const highNum = parseFloat(high);
    if (!name.trim()) return Alert.alert('Bucket name is required');
    if (isNaN(lowNum) || isNaN(highNum) || lowNum >= highNum) {
      return Alert.alert('Yield range invalid', 'Low must be less than high, e.g. 4.0 - 5.5');
    }
    const overlaps = buckets.some(b =>
      b.yield_low != null && b.yield_high != null &&
      lowNum < b.yield_high && highNum > b.yield_low
    );
    if (overlaps) {
      return Alert.alert('Range overlaps', 'This yield range overlaps an existing bucket.');
    }
    await store.getOrCreateBucket(name.trim(), lowNum, highNum);
    setName(''); setLow(''); setHigh('');
    refresh();
  }

  async function handleDeleteBucket(bucketId: number, bucketName: string) {
    Alert.alert('Delete Bucket', `Are you sure you want to delete "${bucketName}"? This can only be done if the bucket is empty.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await store.deleteBucket(bucketId);
            await refresh();
            Alert.alert('Success', 'Bucket deleted successfully');
          } catch (e: any) {
            Alert.alert('Failed to delete', e.message);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Buckets</Text>
      {priceError && <Text style={styles.priceWarning}>Live prices unavailable - showing cost basis only.</Text>}

      <FlatList
        data={buckets}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item, index }) => {
          const summary = summaries[item.name];
          return (
            <Pressable style={styles.bucketCard} onPress={() => navigation.navigate('BucketDetail', { bucket: item.name })}>
              <View style={styles.bucketHeaderRow}>
                <View style={styles.bucketNameRow}>
                  <View style={[styles.dot, { backgroundColor: bucketColorFor(item.name, index) }]} />
                  <Text style={styles.bucketName}>{item.name}</Text>
                </View>
                <View style={styles.bucketRowRight}>
                  <Text style={styles.bucketRange}>
                    {item.yield_low}% – {item.yield_high}%
                  </Text>
                  <Pressable
                    hitSlop={10}
                    style={styles.editButton}
                    onPress={() => navigation.navigate('EditBucket', { bucketId: item.id })}
                  >
                    <Ionicons name="pencil-outline" size={16} color={colors.onSurfaceVariant} />
                  </Pressable>
                  {emptyBucketIds.has(item.id) && (
                    <Pressable
                      hitSlop={10}
                      style={styles.deleteButton}
                      onPress={() => handleDeleteBucket(item.id, item.name)}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.negative} />
                    </Pressable>
                  )}
                </View>
              </View>

              {summary && summary.stockCount > 0 ? (
                <>
                  <View style={styles.miniStatsRow}>
                    <MiniStat label="Stocks" value={String(summary.stockCount)} />
                    <MiniStat label="Cost Basis" value={`₱${summary.costBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                  </View>
                  <View style={styles.miniStatsRow}>
                    <MiniStat
                      label="Market Value"
                      value={summary.marketValue != null ? `₱${summary.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'N/A'}
                      sublabel={summary.unpricedCount > 0 ? `${summary.unpricedCount} unpriced` : undefined}
                    />
                    <MiniStat
                      label="Dividends"
                      value={`₱${summary.dividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      sign={summary.dividends > 0 ? 'positive' : undefined}
                    />
                  </View>
                  {summary.unrealizedGain != null && summary.unrealizedGainPct != null && (
                    <Text style={[styles.gainLine, summary.unrealizedGain >= 0 ? styles.positive : styles.negative]}>
                      {summary.unrealizedGain >= 0 ? '+' : ''}₱{summary.unrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      {' '}({summary.unrealizedGainPct >= 0 ? '+' : ''}{summary.unrealizedGainPct}%) unrealized
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.emptyBucketText}>No holdings in this bucket yet.</Text>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No buckets yet. Add one below.</Text>}
      />

      <View style={styles.form}>
        <View style={styles.formTitleRow}>
          <Text style={styles.formTitle}>Add new bucket</Text>
          <Pressable onPress={() => setInfoOpen(true)} hitSlop={10} style={styles.infoButton} accessibilityLabel="Why multiple buckets?">
            <Ionicons name="help-circle-outline" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
        <TextInput style={styles.input} placeholder="Bucket name (e.g. B5)" placeholderTextColor={colors.onSurfaceVariant} value={name} onChangeText={setName} />
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.half]} placeholder="Yield low %" placeholderTextColor={colors.onSurfaceVariant} value={low} onChangeText={setLow} keyboardType="decimal-pad" />
          <TextInput style={[styles.input, styles.half]} placeholder="Yield high %" placeholderTextColor={colors.onSurfaceVariant} value={high} onChangeText={setHigh} keyboardType="decimal-pad" />
        </View>
        <Pressable style={styles.button} onPress={addBucket}>
          <Text style={styles.buttonText}>Add Bucket</Text>
        </Pressable>
      </View>

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.infoOverlay}>
          <View style={styles.infoContent}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>Why multiple buckets?</Text>
              <Pressable onPress={() => setInfoOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.infoBody}>
              Each bucket is a yield bracket (e.g. 4%–5.5%), not just a folder. Splitting holdings this way keeps
              stocks with similar dividend behavior together, so it's easy to see which range of the portfolio is
              carrying risk versus paying income - and to know exactly which bucket a new buy belongs in.
            </Text>
            <Pressable
              onPress={() => { setInfoOpen(false); navigation.navigate('BucketStrategyInfo'); }}
              hitSlop={6}
            >
              <Text style={styles.infoReadMore}>Read more about the bucket strategy →</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MiniStat({ label, value, sublabel, sign }: { label: string; value: string; sublabel?: string; sign?: 'positive' | 'negative' }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={[styles.miniStatValue, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={styles.miniStatSublabel}>{sublabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: spacing.sm },
  priceWarning: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.negative, marginBottom: spacing.sm },
  bucketCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.base,
  },
  bucketHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  bucketNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bucketRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editButton: { padding: 4 },
  deleteButton: { padding: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bucketName: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface },
  bucketRange: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurfaceVariant },
  miniStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  miniStat: { flex: 1, backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg, padding: spacing.sm },
  miniStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  miniStatValue: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  miniStatSublabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.onSurfaceVariant, marginTop: 1 },
  gainLine: { fontFamily: fonts.mono, fontSize: 12, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  emptyBucketText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant, fontStyle: 'italic' },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
  form: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineVariant, paddingTop: spacing.md },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  formTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface },
  infoButton: { padding: 2 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.sm, fontFamily: fonts.body, fontSize: 15,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  button: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', marginTop: 4 },
  buttonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
  infoOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  infoContent: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md },
  infoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  infoTitle: { fontFamily: fonts.bodySemiBold, fontSize: 17, color: colors.onBackground, flex: 1, marginRight: spacing.sm },
  infoBody: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, lineHeight: 19, marginBottom: spacing.md },
  infoReadMore: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.primary },
});
