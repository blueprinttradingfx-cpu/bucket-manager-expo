// screens/ImportScreen.tsx
// The exact workflow requested during scoping: select bucket -> import file.
// Shows inserted vs. skipped-duplicate counts so a re-import is visibly safe
// rather than a silent no-op that leaves you wondering if it worked.

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useStore } from '../core/StoreProvider';
import { pickStatementFile, parseStatementFile } from '../core/xlsxImport';

interface BucketRow { id: number; name: string }

export default function ImportScreen() {
  const store = useStore();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const b = await store.listBuckets();
    setBuckets(b);
    if (!selected && b.length) setSelected(b[0].name);
  }, [store, selected]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleImport() {
    if (!selected) {
      console.log('[ImportScreen] no bucket selected, aborting');
      return Alert.alert('Select a bucket first');
    }
    console.log('[ImportScreen] opening picker for bucket:', selected);
    const file = await pickStatementFile();
    if (!file) {
      console.log('[ImportScreen] picker returned null (user cancelled or picker failed silently)');
      return;
    }
    console.log('[ImportScreen] picked file:', file.name);

    setBusy(true);
    setLastResult(null);
    try {
      const rows = await parseStatementFile(file.uri);
      console.log('[ImportScreen] parsed', rows.length, 'rows, importing into store');
      const { inserted, skippedDuplicates } = await store.importIntoBucket(selected, rows);
      console.log('[ImportScreen] import complete:', { inserted, skippedDuplicates });
      setLastResult(
        `${file.name}: ${inserted} new transaction${inserted === 1 ? '' : 's'} imported` +
        (skippedDuplicates > 0 ? `, ${skippedDuplicates} already-imported row${skippedDuplicates === 1 ? '' : 's'} skipped` : '')
      );
    } catch (e: any) {
      console.error('[ImportScreen] import failed:', e);
      Alert.alert('Import failed', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (buckets.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Set up at least one bucket first, on the Buckets tab.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Import Statement</Text>
      <Text style={styles.label}>Bucket</Text>
      <FlatList
        horizontal
        data={buckets}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.chip, selected === item.name && styles.chipSelected]}
            onPress={() => setSelected(item.name)}
          >
            <Text style={[styles.chipText, selected === item.name && styles.chipTextSelected]}>
              {item.name}
            </Text>
          </Pressable>
        )}
        style={styles.chipRow}
      />

      <Pressable style={styles.button} onPress={handleImport} disabled={busy}>
        {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Select File to Import</Text>}
      </Pressable>

      {lastResult && <Text style={styles.result}>{lastResult}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0f172a' },
  header: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 16 },
  label: { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  chipRow: { marginBottom: 20, flexGrow: 0 },
  chip: {
    backgroundColor: '#1e293b', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginRight: 8,
  },
  chipSelected: { backgroundColor: '#38bdf8' },
  chipText: { color: '#94a3b8', fontWeight: '600' },
  chipTextSelected: { color: '#0f172a' },
  button: { backgroundColor: '#38bdf8', borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonText: { color: '#0f172a', fontWeight: '700', fontSize: 15 },
  result: { color: '#4ade80', marginTop: 16, fontSize: 14, textAlign: 'center' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
});
