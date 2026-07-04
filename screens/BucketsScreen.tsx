// screens/BucketsScreen.tsx
// Configure buckets: name + yield bracket. This is the "bucket settings are
// configurable" requirement from scoping - no hardcoded count, add as many
// as you actually have DragonFi accounts for.

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { BucketRow } from '../core/storeApi';
import { BucketsStackParamList } from '../core/navigationTypes';

type Props = NativeStackScreenProps<BucketsStackParamList, 'BucketsHome'>;

export default function BucketsScreen({ navigation }: Props) {
  const store = useStore();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [name, setName] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');

  const refresh = useCallback(async () => {
    setBuckets(await store.listBuckets());
  }, [store]);

  useEffect(() => { refresh(); }, [refresh]);

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

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Buckets</Text>
      <FlatList
        data={buckets}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item }) => (
          <Pressable style={styles.bucketRow} onPress={() => navigation.navigate('BucketDetail', { bucket: item.name })}>
            <Text style={styles.bucketName}>{item.name}</Text>
            <Text style={styles.bucketRange}>
              {item.yield_low}% – {item.yield_high}%
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No buckets yet. Add one below.</Text>}
      />

      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Bucket name (e.g. Bucket 5)" value={name} onChangeText={setName} />
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.half]} placeholder="Yield low %" value={low} onChangeText={setLow} keyboardType="decimal-pad" />
          <TextInput style={[styles.input, styles.half]} placeholder="Yield high %" value={high} onChangeText={setHigh} keyboardType="decimal-pad" />
        </View>
        <Pressable style={styles.button} onPress={addBucket}>
          <Text style={styles.buttonText}>Add Bucket</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0f172a' },
  header: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 12 },
  bucketRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  bucketName: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  bucketRange: { color: '#94a3b8', fontSize: 14 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
  form: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 16 },
  input: {
    backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 8,
    padding: 12, marginBottom: 8, fontSize: 15,
  },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  button: { backgroundColor: '#38bdf8', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#0f172a', fontWeight: '700', fontSize: 15 },
});
