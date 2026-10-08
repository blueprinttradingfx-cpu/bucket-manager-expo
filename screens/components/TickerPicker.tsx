// screens/components/TickerPicker.tsx
// Searchable dropdown for choosing a stock/fund ticker. Options come from the
// same universe the Search Stock screen uses (core/stockUniverse.ts) plus the
// fund codes in the fund cache. If either feed is unreachable the picker
// still works: typing a ticker offers a "Use <TICKER>" row so adding a stock
// is never blocked by a network error.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../core/ThemeContext';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { fetchStockUniverse } from '../../core/stockUniverse';
import { fetchFundCache } from '../../core/fundCache';

interface Props {
  value: string;
  onChange: (ticker: string) => void;
  disabled?: boolean;
  /** Tickers that already have a tracker entry - shown but not selectable. */
  disabledTickers?: Set<string>;
}

const MAX_VISIBLE = 60;

export default function TickerPicker({ value, onChange, disabled, disabledTickers }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [fundCodes, setFundCodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Load lazily the first time the dropdown opens.
  useEffect(() => {
    if (!open || options.length > 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [universe, funds] = await Promise.all([
        fetchStockUniverse().catch(() => [] as string[]),
        fetchFundCache().catch(() => null),
      ]);
      if (cancelled) return;
      const fundList = Object.keys(funds?.funds ?? {});
      setFundCodes(new Set(fundList));
      const merged = Array.from(new Set([...universe, ...fundList].map((t) => t.toUpperCase()))).sort();
      setOptions(merged);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, options.length]);

  const q = query.trim().toUpperCase();
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, MAX_VISIBLE);
    // Prefix matches first, then substring matches.
    const starts = options.filter((t) => t.startsWith(q));
    const contains = options.filter((t) => !t.startsWith(q) && t.includes(q));
    return [...starts, ...contains].slice(0, MAX_VISIBLE);
  }, [options, q]);

  const exactMatch = !!q && options.includes(q);

  function select(t: string) {
    onChange(t);
    setOpen(false);
    setQuery('');
  }

  return (
    <View>
      <Pressable
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {value || 'Select a stock…'}
        </Text>
        {!disabled && (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.onSurfaceVariant} />
        )}
      </Pressable>

      {open && (
        <View style={styles.dropdown}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search ticker…"
            placeholderTextColor={colors.onSurfaceVariant}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {loading && <ActivityIndicator style={{ margin: spacing.sm }} color={colors.primary} />}
            {!loading && !!q && !exactMatch && (
              <Pressable style={styles.row} onPress={() => select(q)}>
                <Text style={styles.rowText}>Use “{q}”</Text>
              </Pressable>
            )}
            {filtered.map((t) => {
              const taken = disabledTickers?.has(t) ?? false;
              return (
                <Pressable
                  key={t}
                  style={[styles.row, t === value && styles.rowActive]}
                  onPress={() => !taken && select(t)}
                  disabled={taken}
                >
                  <Text style={[styles.rowText, taken && styles.rowTextTaken]}>{t}</Text>
                  {fundCodes.has(t) && <Text style={styles.tag}>Fund</Text>}
                  {taken && <Text style={styles.tag}>Already tracked</Text>}
                </Pressable>
              );
            })}
            {!loading && filtered.length === 0 && !q && (
              <Text style={styles.empty}>Couldn't load the stock list - type a ticker above.</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.sm,
      paddingVertical: 10,
    },
    fieldDisabled: { opacity: 0.6, backgroundColor: colors.surfaceContainerHighest },
    fieldText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurface },
    placeholder: { color: colors.onSurfaceVariant },
    dropdown: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    search: {
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.onSurface,
      backgroundColor: colors.surfaceContainerHigh,
    },
    list: { maxHeight: 220 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 10,
    },
    rowActive: { backgroundColor: colors.surfaceContainerHigh },
    rowText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface, flex: 1 },
    rowTextTaken: { color: colors.onSurfaceVariant },
    tag: { fontFamily: fonts.body, fontSize: 11, color: colors.onSurfaceVariant, marginLeft: spacing.xs },
    empty: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant, padding: spacing.sm },
  });
}
