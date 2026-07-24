// screens/EditBucketScreen.tsx
// Rename a bucket and/or adjust its yield bracket. Reached from a pencil
// icon on each row in BucketsScreen. Renaming is safe with respect to
// existing holdings/transactions - they're keyed by bucket ID internally
// (see db.native.ts/db.web.ts), never by name, so a rename here doesn't
// orphan anything.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Alert from '../core/alert';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { BucketRow } from '../core/storeApi';
import { BucketsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';

type Props = NativeStackScreenProps<BucketsStackParamList, 'EditBucket'>;

export default function EditBucketScreen({ route, navigation }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { bucketId } = route.params;
  useScreenViewLog('EditBucket', { bucketId });
  const store = useStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [allBuckets, setAllBuckets] = useState<BucketRow[]>([]);

  useEffect(() => {
    (async () => {
      const buckets = await store.listBuckets();
      setAllBuckets(buckets);
      const current = buckets.find((b) => b.id === bucketId);
      if (current) {
        setName(current.name);
        setLow(current.yield_low != null ? String(current.yield_low) : '');
        setHigh(current.yield_high != null ? String(current.yield_high) : '');
      }
      setLoading(false);
    })();
  }, [store, bucketId]);

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return Alert.alert('Bucket name is required');

    const lowNum = low.trim() === '' ? null : parseFloat(low);
    const highNum = high.trim() === '' ? null : parseFloat(high);
    if ((lowNum != null && isNaN(lowNum)) || (highNum != null && isNaN(highNum))) {
      return Alert.alert('Yield range invalid', 'Enter numbers only, e.g. 4.0 and 5.5.');
    }
    if (lowNum != null && highNum != null && lowNum >= highNum) {
      return Alert.alert('Yield range invalid', 'Low must be less than high.');
    }

    const overlaps = allBuckets.some((b) =>
      b.id !== bucketId && lowNum != null && highNum != null &&
      b.yield_low != null && b.yield_high != null &&
      lowNum < b.yield_high && highNum > b.yield_low
    );
    if (overlaps) {
      return Alert.alert('Range overlaps', 'This yield range overlaps another bucket.');
    }

    setSaving(true);
    try {
      await store.updateBucket(bucketId, { name: trimmedName, yieldLow: lowNum, yieldHigh: highNum });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? String(e));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Bucket name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. B5" placeholderTextColor={colors.onSurfaceVariant} />

      <Text style={styles.label}>Yield range</Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.half]} value={low} onChangeText={setLow} placeholder="Low %" placeholderTextColor={colors.onSurfaceVariant} keyboardType="decimal-pad" />
        <TextInput style={[styles.input, styles.half]} value={high} onChangeText={setHigh} placeholder="High %" placeholderTextColor={colors.onSurfaceVariant} keyboardType="decimal-pad" />
      </View>
      <Text style={styles.hint}>Leave both blank if this bucket isn't yield-based.</Text>

      <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Save Changes</Text>}
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background, ...centeredContent },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm + 4, fontFamily: fonts.body, fontSize: 15,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  hint: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 6 },
  button: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
});
