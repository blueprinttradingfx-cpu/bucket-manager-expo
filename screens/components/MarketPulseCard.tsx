// screens/components/MarketPulseCard.tsx
// Compact strip shown near the top of DashboardScreen - PSEi price/change,
// sentiment reading, and a few top-mover chips, tapping through to the
// full MarketPulseScreen. Same "View all →" card convention as
// MonthlyDividendChart.tsx.
//
// Fetches independently of the rest of Dashboard (own effect, own
// loading/error state) - this is market-wide context, not the person's
// portfolio, so it must never block or slow down the core Dashboard load.
// Deliberately diverges from CompanyDetailsSection.tsx's precedent of
// showing a quiet "not available" card on failure: that screen is
// dedicated to one ticker, so "not available" is itself meaningful
// content. Here, sitting among the portfolio dashboard, a failed fetch
// just means today there's no card - rendering nothing is less clutter
// than a permanent error box for a purely supplementary feature.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { fetchMarketPulse, MarketPulseData, MoverStock } from '../../core/marketPulseCache';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

export default function MarketPulseCard({ onPress, onTickerPress }: {
  onPress: () => void;
  onTickerPress: (ticker: string) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState<MarketPulseData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMarketPulse()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => console.log('[MarketPulseCard] unexpected error:', e?.message ?? e));
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;

  const { psei, marketSentiment } = data.marketPulse;
  const positive = psei.changePercent >= 0;
  // Top 3 gainers as tappable chips - a quick "what's moving" glance
  // without leaving Dashboard. Losers live on the full screen only, to
  // keep this strip to one row.
  const chips: MoverStock[] = data.marketMovers.topGainers.slice(0, 3);
  const sentimentLabel = marketSentiment.bbr > 55 ? 'Bullish' : marketSentiment.bbr < 45 ? 'Bearish' : 'Neutral';
  const sentimentColor = marketSentiment.bbr > 55 ? colors.positive : marketSentiment.bbr < 45 ? colors.negative : colors.onSurfaceVariant;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Market Pulse</Text>
        <Text style={styles.viewAll}>View all →</Text>
      </View>

      <View style={styles.topRow}>
        <View style={styles.pseiBlock}>
          <Text style={styles.pseiLabel}>PSEi</Text>
          <Text style={styles.pseiValue}>{psei.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          <Text style={[styles.pseiChange, { color: positive ? colors.positive : colors.negative }]}>
            {positive ? '+' : ''}{psei.changePrice.toFixed(2)} ({positive ? '+' : ''}{psei.changePercent.toFixed(2)}%)
          </Text>
        </View>
        <View style={[styles.sentimentPill, { borderColor: sentimentColor }]}>
          <Text style={[styles.sentimentText, { color: sentimentColor }]}>{sentimentLabel}</Text>
        </View>
      </View>

      {chips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {chips.map((m) => (
            <Pressable
              key={m.symbol}
              style={styles.moverChip}
              onPress={(e) => { e.stopPropagation(); onTickerPress(m.symbol); }}
            >
              <Text style={styles.moverSymbol}>{m.symbol}</Text>
              <Text style={[styles.moverChange, { color: colors.positive }]}>+{m.changePercent.toFixed(1)}%</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface },
  viewAll: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  pseiBlock: {},
  pseiLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  pseiValue: { fontFamily: fonts.monoBold, fontSize: 22, color: colors.onSurface },
  pseiChange: { fontFamily: fonts.mono, fontSize: 13, marginTop: 2 },
  sentimentPill: {
    borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  sentimentText: { fontFamily: fonts.bodySemiBold, fontSize: 12 },
  chipsScroll: { marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  moverChip: {
    backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.default,
    paddingHorizontal: spacing.sm, paddingVertical: 6, marginRight: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  moverSymbol: { fontFamily: fonts.monoSemiBold, fontSize: 12, color: colors.onSurface },
  moverChange: { fontFamily: fonts.mono, fontSize: 12 },
});
