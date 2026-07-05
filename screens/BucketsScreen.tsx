// screens/BucketsScreen.tsx
// Configure buckets: name + yield bracket. This is the "bucket settings are
// configurable" requirement from scoping - no hardcoded count, add as many
// as you actually have DragonFi accounts for. Restyled to match the Stitch
// design system (see DashboardScreen for the full rationale) - each row
// now shows its Yield Distribution color dot via bucketColorFor.

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import Alert from '../core/alert';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../core/StoreProvider';
import { BucketRow } from '../core/storeApi';
import { BucketsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts, bucketColorFor } from '../core/theme';

type Props = NativeStackScreenProps<BucketsStackParamList, 'BucketsHome'>;

export default function BucketsScreen({ navigation }: Props) {
  useScreenViewLog('Buckets');
  const store = useStore();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [emptyBucketIds, setEmptyBucketIds] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');

  const refresh = useCallback(async () => {
    const bucketList = await store.listBuckets();
    setBuckets(bucketList);
    const emptyIds = new Set<number>();
    for (const bucket of bucketList) {
      try {
        const holdings = await store.getBucketHoldings(bucket.name);
        if (holdings.holdings.length === 0 && holdings.orphanSells.length === 0) {
          emptyIds.add(bucket.id);
        }
      } catch (e) {
        // If we can't check holdings, assume not empty to be safe
      }
    }
    setEmptyBucketIds(emptyIds);
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
      <FlatList
        data={buckets}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item, index }) => (
          <Pressable style={styles.bucketRow} onPress={() => navigation.navigate('BucketDetail', { bucket: item.name })}>
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
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No buckets yet. Add one below.</Text>}
      />

      <View style={styles.form}>
        <Text style={styles.formTitle}>Add new bucket</Text>
        <TextInput style={styles.input} placeholder="Bucket name (e.g. B5)" placeholderTextColor={colors.onSurfaceVariant} value={name} onChangeText={setName} />
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.half]} placeholder="Yield low %" placeholderTextColor={colors.onSurfaceVariant} value={low} onChangeText={setLow} keyboardType="decimal-pad" />
          <TextInput style={[styles.input, styles.half]} placeholder="Yield high %" placeholderTextColor={colors.onSurfaceVariant} value={high} onChangeText={setHigh} keyboardType="decimal-pad" />
        </View>
        <Pressable style={styles.button} onPress={addBucket}>
          <Text style={styles.buttonText}>Add Bucket</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: spacing.md },
  bucketRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.base,
  },
  bucketNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bucketRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editButton: { padding: 4 },
  deleteButton: { padding: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bucketName: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface },
  bucketRange: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurfaceVariant },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
  form: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineVariant, paddingTop: spacing.md },
  formTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.sm, fontFamily: fonts.body, fontSize: 15,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  button: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', marginTop: 4 },
  buttonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
});
