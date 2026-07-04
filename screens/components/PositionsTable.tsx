// screens/components/PositionsTable.tsx
// Shared "Positions" list, restyled to match the Stitch design export
// (stitch_bucket_portfolio_design_system[_mobile].zip). Mobile's own
// mockup hides the desktop-only column header row and "Sort by" dropdown
// entirely, but this app already has working sort - rather than drop it
// to match the mockup literally, it's kept as a single compact control
// styled like the desktop version's "Sort by  Dividends ⌄" button, split
// into two tap zones (label cycles the field, chevron flips direction).
// Used by DashboardScreen, BucketDetailScreen, and StockDetailScreen so
// all three stay visually and behaviorally consistent.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { AssetType } from '../../core/bucketLogic';
import { colors, spacing, radii, fonts } from '../../core/theme';

export type SortKey = 'value' | 'gain' | 'dividends' | 'name' | 'qty';

const SORT_LABELS: Record<SortKey, string> = {
  value: 'Price', gain: 'Returns', dividends: 'Dividends', qty: 'Qty', name: 'Name',
};
const SORT_CYCLE: SortKey[] = ['value', 'gain', 'dividends', 'qty', 'name'];

export interface PositionItem {
  key: string;
  label: string;
  badgeText: string;
  badgeVariant: AssetType | 'neutral';
  qty: number;
  avgCost: number;
  costBasis: number;
  dividends: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  assetType?: AssetType;
  expandedContent: React.ReactNode;
}

export interface AssetTabDef {
  key: 'all' | AssetType;
  label: string;
  count: number;
}

interface Props {
  items: PositionItem[];
  onItemPress: (key: string) => void;
  tabs?: AssetTabDef[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  emptyText?: string;
}

function sortValue(item: PositionItem, key: SortKey): number | string {
  switch (key) {
    case 'value':
      return item.marketValue ?? item.costBasis;
    case 'gain':
      return item.unrealizedGainPct ?? -Infinity;
    case 'dividends':
      return item.dividends;
    case 'qty':
      return item.qty;
    case 'name':
      return item.label;
  }
}

export default function PositionsTable({ items, onItemPress, tabs, activeTab, onTabChange, emptyText = 'Nothing here yet.' }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv;
      return sortAsc ? cmp : -cmp;
    });
  }, [items, sortKey, sortAsc]);

  function cycleSortField() {
    const next = SORT_CYCLE[(SORT_CYCLE.indexOf(sortKey) + 1) % SORT_CYCLE.length];
    setSortKey(next);
    setSortAsc(next === 'name');
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <View>
      <View style={styles.controlsRow}>
        {tabs && tabs.length > 0 && (
          <View style={styles.tabTrack}>
            {tabs.map((t) => (
              <TabButton key={t.key} label={t.label} count={t.count} active={activeTab === t.key} onPress={() => onTabChange?.(t.key)} />
            ))}
          </View>
        )}
        <View style={styles.sortControl}>
          <Text style={styles.sortByLabel}>Sort by</Text>
          <Pressable style={styles.sortButton} onPress={cycleSortField}>
            <Text style={styles.sortButtonText}>{SORT_LABELS[sortKey]}</Text>
            <Pressable hitSlop={8} onPress={() => setSortAsc((a) => !a)}>
              <Text style={styles.sortCaret}>{sortAsc ? '︿' : '⌄'}</Text>
            </Pressable>
          </Pressable>
        </View>
      </View>

      {sorted.length === 0 && <Text style={styles.empty}>{emptyText}</Text>}

      <View style={styles.list}>
        {sorted.map((item) => {
          const isOpen = expanded.has(item.key);
          const hasGain = item.unrealizedGain != null;
          return (
            <View key={item.key} style={styles.card}>
              <Pressable style={styles.row} onPress={() => onItemPress(item.key)}>
                <Pressable hitSlop={10} style={styles.chevronTap} onPress={() => toggleExpanded(item.key)}>
                  <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>{isOpen ? '⌄' : '›'}</Text>
                </Pressable>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.badgeText}</Text>
                </View>
                <Text style={styles.label} numberOfLines={1}>{item.label}</Text>

                <View style={styles.priceCol}>
                  <Text style={styles.priceValue}>
                    {item.currentPrice != null ? `₱${item.currentPrice}` : `₱${item.avgCost}`}
                  </Text>
                  <Text style={styles.qtySubtext}>{item.qty.toLocaleString()} Qty</Text>
                </View>

                <View style={styles.plCol}>
                  {hasGain ? (
                    <>
                      <Text style={[styles.plAmount, item.unrealizedGain! >= 0 ? styles.positive : styles.negative]}>
                        {item.unrealizedGain! >= 0 ? '+' : ''}{item.unrealizedGain!.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </Text>
                      <Text style={[styles.plPct, item.unrealizedGainPct! >= 0 ? styles.positive : styles.negative]}>
                        {item.unrealizedGainPct! >= 0 ? '+' : ''}{item.unrealizedGainPct}%
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.plUnavailable}>—</Text>
                  )}
                </View>
              </Pressable>

              {isOpen && <View style={styles.expandedPanel}>{item.expandedContent}</View>}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function ExpandedRow({ label, value, valueStyle }: { label: string; value: string; valueStyle?: any }) {
  return (
    <View style={styles.expandedRow}>
      <Text style={styles.expandedLabel}>{label}</Text>
      <Text style={[styles.expandedValue, valueStyle]}>{value}</Text>
    </View>
  );
}

function TabButton({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>
        {label} <Text style={styles.tabButtonCount}>{count}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  tabTrack: { flexDirection: 'row', backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.lg, padding: 2 },
  tabButton: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.lg - 1 },
  tabButtonActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabButtonText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  tabButtonTextActive: { fontFamily: fonts.bodyBold, color: colors.primary },
  tabButtonCount: { opacity: 0.5 },
  sortControl: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sortByLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  sortButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  sortButtonText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurface },
  sortCaret: { color: colors.onSurfaceVariant, fontSize: 13 },
  list: { gap: spacing.base },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 30 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  chevronTap: { width: 20 },
  chevron: { color: colors.onSurfaceVariant, fontSize: 20 },
  chevronOpen: { color: colors.primary },
  badge: {
    width: 40, height: 40, borderRadius: radii.full, marginRight: spacing.md,
    backgroundColor: colors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.primary },
  label: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface, flex: 1 },
  priceCol: { alignItems: 'flex-end', minWidth: 78 },
  priceValue: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  qtySubtext: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  plCol: { alignItems: 'flex-end', minWidth: 90, marginLeft: spacing.sm },
  plAmount: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  plPct: { fontFamily: fonts.mono, fontSize: 11, marginTop: 2 },
  plUnavailable: { color: colors.outline, fontSize: 14 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  expandedPanel: {
    backgroundColor: colors.surfaceVariant, borderTopWidth: 1, borderTopColor: colors.outlineVariant,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  expandedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  expandedLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant },
  expandedValue: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurface },
});
