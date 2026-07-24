// screens/components/WatchlistTable.tsx
// The Watch List's row list - visually modeled on PositionsTable (same
// card/badge/chevron/expandedPanel tokens) so the app doesn't grow a
// second, differently-styled list pattern, but with watchlist-specific
// fields (buy-below price, in-range state) instead of portfolio ones
// (qty, cost basis) since a watched ticker isn't necessarily held.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { YieldBracket, suggestBucketForYield } from '../../core/bucketLogic';
import { spacing, radii, fonts, bucketColorFor, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import WatchlistBuyBelowEditor from './WatchlistBuyBelowEditor';

export interface WatchlistRowItem {
  ticker: string;
  currentPrice: number | null;
  yieldPct: number | null;
  buyBelowPrice: number | null;
  withinRange: boolean;
}

interface Props {
  items: WatchlistRowItem[];
  buckets: YieldBracket[];
  onItemPress: (ticker: string) => void;
  onSaveBuyBelow: (ticker: string, price: number | null) => Promise<void>;
  onRemove: (ticker: string) => void;
  emptyText?: string;
}

export default function WatchlistTable({ items, buckets, onItemPress, onSaveBuyBelow, onRemove, emptyText = 'Nothing here yet.' }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(ticker: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const isOpen = expanded.has(item.ticker);
        const suggestion = item.yieldPct != null ? suggestBucketForYield(item.yieldPct, buckets) : null;
        return (
          <View key={item.ticker} style={[styles.card, item.withinRange && styles.cardWithinRange]}>
            <Pressable style={styles.row} onPress={() => onItemPress(item.ticker)}>
              <Pressable hitSlop={10} style={styles.chevronTap} onPress={() => toggleExpanded(item.ticker)}>
                <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>{isOpen ? '⌄' : '›'}</Text>
              </Pressable>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.ticker.slice(0, 2)}</Text>
              </View>
              <View style={styles.labelCol}>
                <Text style={styles.label} numberOfLines={1}>{item.ticker}</Text>
                <Text style={styles.buyBelowSubtext}>
                  {item.buyBelowPrice != null ? `Buy below ₱${item.buyBelowPrice}` : 'No target price set'}
                </Text>
              </View>

              <View style={styles.priceCol}>
                <Text style={styles.priceValue}>{item.currentPrice != null ? `₱${item.currentPrice}` : 'N/A'}</Text>
                <Text style={styles.yieldSubtext}>{item.yieldPct != null ? `${item.yieldPct}% yield` : 'no yield data'}</Text>
              </View>
            </Pressable>

            {(item.withinRange || (suggestion?.reason === 'match' && suggestion.bucket)) && (
              <View style={styles.metaRow}>
                {item.withinRange && (
                  <View style={styles.rangePill}>
                    <Ionicons name="checkmark-circle" size={12} color={colors.positive} />
                    <Text style={styles.rangePillText}>Within buy range</Text>
                  </View>
                )}
                {suggestion?.reason === 'match' && suggestion.bucket && (
                  <View style={[styles.bucketChip, { backgroundColor: bucketColorFor(suggestion.bucket.name) + '22', borderColor: bucketColorFor(suggestion.bucket.name) }]}>
                    <Text style={[styles.bucketChipText, { color: bucketColorFor(suggestion.bucket.name) }]}>Buy into {suggestion.bucket.name}</Text>
                  </View>
                )}
              </View>
            )}

            {isOpen && (
              <View style={styles.expandedPanel}>
                <WatchlistBuyBelowEditor
                  value={item.buyBelowPrice}
                  currentPrice={item.currentPrice}
                  onSave={(price) => onSaveBuyBelow(item.ticker, price)}
                />

                <View style={styles.suggestionRow}>
                  {suggestion == null && (
                    <Text style={styles.suggestionText}>No dividend yield data available yet for {item.ticker}.</Text>
                  )}
                  {suggestion?.reason === 'match' && suggestion.bucket && (
                    <Text style={styles.suggestionText}>
                      Recommended bucket: <Text style={styles.suggestionBucketName}>{suggestion.bucket.name}</Text> ({suggestion.bucket.yield_low}%–{suggestion.bucket.yield_high}%)
                    </Text>
                  )}
                  {suggestion?.reason === 'no_matching_range' && (
                    <Text style={styles.suggestionText}>
                      No bucket's yield range covers {item.yieldPct}%.
                      {suggestion.nearestBucket && ` Closest is ${suggestion.nearestBucket.name} (${suggestion.nearestBucket.yield_low}%–${suggestion.nearestBucket.yield_high}%).`}
                    </Text>
                  )}
                  {suggestion?.reason === 'no_buckets_configured' && (
                    <Text style={styles.suggestionText}>No buckets have a yield range set yet - add one in the Buckets tab.</Text>
                  )}
                </View>

                <Pressable style={styles.removeButton} onPress={() => onRemove(item.ticker)}>
                  <Ionicons name="trash-outline" size={14} color={colors.negative} />
                  <Text style={styles.removeButtonText}>Remove from Watch List</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: spacing.base },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 30 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, overflow: 'hidden',
  },
  cardWithinRange: { borderColor: colors.positive },
  row: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chevronTap: { width: 20 },
  chevron: { color: colors.onSurfaceVariant, fontSize: 20 },
  chevronOpen: { color: colors.primary },
  badge: {
    width: 40, height: 40, borderRadius: radii.full, marginRight: spacing.md,
    backgroundColor: colors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.primary },
  labelCol: { flex: 1 },
  label: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  buyBelowSubtext: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  priceCol: { alignItems: 'flex-end', minWidth: 82 },
  priceValue: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  yieldSubtext: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingLeft: 20 + spacing.md + 40 + spacing.md, paddingBottom: spacing.md },
  rangePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.positive, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  rangePillText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.positive },
  bucketChip: {
    borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  bucketChipText: { fontFamily: fonts.bodyBold, fontSize: 10 },
  expandedPanel: {
    backgroundColor: colors.surfaceVariant, borderTopWidth: 1, borderTopColor: colors.outlineVariant,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md,
  },
  suggestionRow: {},
  suggestionText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant, lineHeight: 17 },
  suggestionBucketName: { fontFamily: fonts.bodyBold, color: colors.primary },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  removeButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.negative },
});
