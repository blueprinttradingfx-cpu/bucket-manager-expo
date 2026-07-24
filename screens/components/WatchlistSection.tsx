// screens/components/WatchlistSection.tsx
// The "Add to Watch List" card on StockDetailScreen - the one card shared
// by every stock view, held or not, since StockDetailScreen now handles
// both the held and not-held states (see its own comment). Mirrors
// WatchlistTable's row content (buy-below price, within-range pill) so a
// ticker looks the same here as it does on the Watch List tab itself,
// just without the ticker/price header row since the screen it's embedded
// in already shows those.

import React, { useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import WatchlistBuyBelowEditor from './WatchlistBuyBelowEditor';

interface Props {
  inWatchlist: boolean;
  buyBelowPrice: number | null;
  currentPrice: number | null;
  busy: boolean;
  onToggle: () => void;
  onSaveBuyBelow: (price: number | null) => Promise<void>;
}

export default function WatchlistSection({ inWatchlist, buyBelowPrice, currentPrice, busy, onToggle, onSaveBuyBelow }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const withinRange = inWatchlist && buyBelowPrice != null && currentPrice != null && currentPrice <= buyBelowPrice;

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name={inWatchlist ? 'eye' : 'eye-outline'} size={16} color={inWatchlist ? colors.primary : colors.onSurfaceVariant} />
          <Text style={styles.title}>Watch List</Text>
        </View>
        <Pressable
          style={[styles.toggleButton, inWatchlist ? styles.toggleButtonRemove : styles.toggleButtonAdd]}
          onPress={onToggle}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={inWatchlist ? colors.negative : colors.onPrimary} />
          ) : (
            <Text style={[styles.toggleButtonText, inWatchlist ? styles.toggleButtonTextRemove : styles.toggleButtonTextAdd]}>
              {inWatchlist ? 'Remove from Watch List' : 'Add to Watch List'}
            </Text>
          )}
        </Pressable>
      </View>

      {inWatchlist && (
        <View style={styles.body}>
          {withinRange && (
            <View style={styles.rangePill}>
              <Ionicons name="checkmark-circle" size={12} color={colors.positive} />
              <Text style={styles.rangePillText}>Within buy range</Text>
            </View>
          )}
          <WatchlistBuyBelowEditor value={buyBelowPrice} currentPrice={currentPrice} onSave={onSaveBuyBelow} />
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface },
  toggleButton: { borderRadius: radii.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm - 2, minWidth: 96, alignItems: 'center' },
  toggleButtonAdd: { backgroundColor: colors.primary },
  toggleButtonRemove: { borderWidth: 1, borderColor: colors.negative },
  toggleButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12 },
  toggleButtonTextAdd: { color: colors.onPrimary },
  toggleButtonTextRemove: { color: colors.negative },
  body: { marginTop: spacing.md, gap: spacing.sm },
  rangePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: colors.positive, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  rangePillText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.positive },
});
