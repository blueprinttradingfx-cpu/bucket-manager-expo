// screens/components/WatchlistBuyBelowEditor.tsx
// Inline (not modal) numeric editor for a watchlisted ticker's buy-below
// price - lives inside an already-expanded panel (WatchlistTable's row, or
// WatchlistSection on StockDetailScreen), so unlike
// PassiveIncomeGoalCard's "Set Goal" popup this doesn't need its own
// Modal - a second overlay on top of an already-expanded panel would be
// one too many layers. Same validation shape as PassiveIncomeGoalCard
// (trim, strip commas, require > 0) for consistency, plus a Clear action
// since a buy-below price is optional here (unlike the income goal).

import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

interface Props {
  value: number | null;
  currentPrice: number | null;
  onSave: (price: number | null) => Promise<void> | void;
}

export default function WatchlistBuyBelowEditor({ value, currentPrice, onSave }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDraft(value != null ? String(value) : '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError('Enter a price, or use Clear to remove the target.');
      return;
    }
    const parsed = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a price greater than 0.');
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch {
      // Parent (StockDetailScreen / WatchListScreen) surfaces the error via
      // Alert - nothing extra to do here beyond leaving the editor open so
      // the person's typed value isn't lost.
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      await onSave(null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View style={styles.readRow}>
        <View>
          <Text style={styles.readLabel}>Buy below price</Text>
          <Text style={styles.readValue}>{value != null ? `₱${value}` : 'Not set'}</Text>
        </View>
        <Pressable style={styles.editButton} onPress={startEditing}>
          <Text style={styles.editButtonText}>{value != null ? 'Edit' : 'Set price'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.readLabel}>Buy below price</Text>
      <View style={styles.editRow}>
        <TextInput
          style={[styles.input, error && styles.inputError]}
          value={draft}
          onChangeText={(t) => { setDraft(t); setError(null); }}
          placeholder={currentPrice != null ? `e.g. ${currentPrice}` : 'e.g. 34.20'}
          placeholderTextColor={colors.onSurfaceVariant}
          keyboardType="decimal-pad"
          autoFocus
        />
        <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveButtonText}>{saving ? '...' : 'Save'}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.editActionsRow}>
        {value != null && (
          <Pressable onPress={handleClear} disabled={saving} hitSlop={8}>
            <Text style={styles.clearText}>Clear target price</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setEditing(false)} disabled={saving} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  readRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  readValue: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface },
  editButton: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
  },
  editButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.primary },
  editRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1, fontFamily: fonts.mono, fontSize: 15, color: colors.onSurface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm,
  },
  inputError: { borderColor: colors.negative },
  saveButton: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onPrimary },
  errorText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative, marginTop: 6 },
  editActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  clearText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
});
