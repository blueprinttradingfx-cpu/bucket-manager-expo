// screens/components/ImportPortfolioModal.tsx
// Lets the user browse the shared "portfolios" bundled in /portfolios (see
// core/portfolioCatalog.ts) and copy one or more of them into their own
// Watch List. Multi-select (not single-pick) so "import many portfolios"
// is one action instead of reopening this modal per portfolio. Visual
// pattern borrowed from ImportScreen's stock-picker Modal (bottom sheet,
// overlay, header with close X) so the app doesn't grow a second modal
// style.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { PORTFOLIO_CATALOG, Portfolio } from '../../core/portfolioCatalog';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Resolves once the store write + refresh is done - the modal shows a
   *  spinner on the import button and stays open until then, so the person
   *  sees their tap register instead of the sheet vanishing immediately. */
  onImport: (portfolios: Portfolio[]) => Promise<void>;
}

export default function ImportPortfolioModal({ visible, onClose, onImport }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Fresh selection every time the sheet is opened, rather than remembering
  // what was picked (or left expanded) from a previous visit.
  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setExpanded(new Set());
    }
  }, [visible]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedPortfolios = PORTFOLIO_CATALOG.filter((p) => selected.has(p.id));
  // Unique ticker count across every selected portfolio - lets the person
  // see "23 tickers" rather than having to add up per-portfolio counts
  // themselves when a stock like AREIT shows up in three of them.
  const uniqueTickerCount = useMemo(() => {
    const tickers = new Set<string>();
    selectedPortfolios.forEach((p) => p.stocks.forEach((s) => tickers.add(s.ticker)));
    return tickers.size;
  }, [selected]);

  async function handleImport() {
    if (selectedPortfolios.length === 0 || importing) return;
    setImporting(true);
    try {
      await onImport(selectedPortfolios);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Import Portfolio</Text>
              <Text style={styles.subtitle}>Copy someone else's ticker list into your Watch List.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {PORTFOLIO_CATALOG.length === 0 && (
              <Text style={styles.empty}>No shared portfolios found in /portfolios yet.</Text>
            )}
            {PORTFOLIO_CATALOG.map((portfolio) => {
              const isSelected = selected.has(portfolio.id);
              const isExpanded = expanded.has(portfolio.id);
              return (
                <View key={portfolio.id} style={[styles.card, isSelected && styles.cardSelected]}>
                  <Pressable style={styles.row} onPress={() => toggleSelected(portfolio.id)}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.primary : colors.onSurfaceVariant}
                      style={styles.checkbox}
                    />
                    <View style={styles.labelCol}>
                      <Text style={styles.label} numberOfLines={1}>{portfolio.name}</Text>
                      <Text style={styles.countText}>
                        {portfolio.stocks.length} ticker{portfolio.stocks.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Pressable hitSlop={10} style={styles.expandTap} onPress={() => toggleExpanded(portfolio.id)}>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.onSurfaceVariant}
                      />
                    </Pressable>
                  </Pressable>

                  {isExpanded && (
                    <View style={styles.previewWrap}>
                      {portfolio.stocks.map((s) => (
                        <View key={s.ticker} style={styles.tickerChip}>
                          <Text style={styles.tickerChipText}>
                            {s.ticker}{s.buyBelowPrice != null ? ` · ₱${s.buyBelowPrice}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerHint}>
              {selectedPortfolios.length === 0
                ? 'Select one or more portfolios to import.'
                : `${selectedPortfolios.length} portfolio${selectedPortfolios.length === 1 ? '' : 's'} selected · ${uniqueTickerCount} unique ticker${uniqueTickerCount === 1 ? '' : 's'}`}
            </Text>
            <Pressable
              style={[styles.importButton, selectedPortfolios.length === 0 && styles.importButtonDisabled]}
              onPress={handleImport}
              disabled={selectedPortfolios.length === 0 || importing}
            >
              {importing
                ? <ActivityIndicator color={colors.onPrimary} />
                : <Text style={styles.importButtonText}>
                    Import{selectedPortfolios.length > 0 ? ` (${selectedPortfolios.length})` : ''}
                  </Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '85%', paddingTop: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.onBackground },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2, maxWidth: 260 },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 30 },
  card: {
    backgroundColor: colors.surfaceVariant, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, overflow: 'hidden', marginBottom: spacing.sm,
  },
  cardSelected: { borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  checkbox: { marginRight: 2 },
  labelCol: { flex: 1 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface },
  countText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  expandTap: { padding: 4 },
  previewWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  tickerChip: {
    backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.full,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  tickerChipText: { fontFamily: fonts.monoSemiBold, fontSize: 11, color: colors.onSurface },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineVariant },
  footerHint: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginBottom: spacing.sm, textAlign: 'center' },
  importButton: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.md, alignItems: 'center' },
  importButtonDisabled: { opacity: 0.4 },
  importButtonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
});
