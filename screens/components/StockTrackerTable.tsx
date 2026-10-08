// screens/components/StockTrackerTable.tsx
// Table view for StockTrackerScreen: displays tracked stocks with columns for
// Ticker, Last Price, Area of Interest, Weekly MACD Trend, Foreign Flow,
// Event (date + details), Projection, Linked Price Alert, and row actions.
// Supports responsive horizontal scrolling on narrow screens with sticky left column.

import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StockTrackerEntry, WeeklyMacdTrend, ForeignFlowSentiment, StockAlert } from '../../core/storeApi';
import { spacing, radii, fonts, layout, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import TickerLogo from './TickerLogo';

export interface DisplayTrackerEntry extends StockTrackerEntry {
  currentPrice: number | null;
  linkedAlert?: StockAlert | null;
}

interface Props {
  entries: DisplayTrackerEntry[];
  onSelectEntry: (entry: DisplayTrackerEntry) => void;
  onDeleteEntry: (id: string) => void;
  onNavigateToStock: (ticker: string) => void;
  /** T-07: called when user taps the alert chip in the table row. */
  onAlertPress?: (ticker: string) => void;
  emptyText?: string;
}

const MACD_CONFIG: Record<
  WeeklyMacdTrend,
  { label: string; short: string; icon: keyof typeof Ionicons.glyphMap; colorKey: 'positive' | 'negative' | 'onSurfaceVariant' | 'primary' }
> = {
  'bullish-converging': { label: 'Bullish Conv.', short: 'BCV', icon: 'trending-up', colorKey: 'positive' },
  'bullish-diverging': { label: 'Bullish Div.', short: 'BDV', icon: 'trending-up', colorKey: 'positive' },
  'bearish-converging': { label: 'Bearish Conv.', short: 'SCV', icon: 'trending-down', colorKey: 'negative' },
  'bearish-diverging': { label: 'Bearish Div.', short: 'SDV', icon: 'trending-down', colorKey: 'negative' },
  'sideways': { label: 'Sideways', short: 'SIDE', icon: 'swap-horizontal', colorKey: 'onSurfaceVariant' },
  'none': { label: 'None', short: 'NONE', icon: 'remove-outline', colorKey: 'onSurfaceVariant' },
  'custom': { label: 'Custom', short: 'CUST', icon: 'create-outline', colorKey: 'primary' },
};

const FF_CONFIG: Record<
  ForeignFlowSentiment,
  { label: string; short: string; colorKey: 'positive' | 'negative' | 'onSurfaceVariant' }
> = {
  'strong-buying': { label: 'Strong Buy', short: 'S-BUY', colorKey: 'positive' },
  'buying': { label: 'Buying', short: 'BUY', colorKey: 'positive' },
  'neutral': { label: 'Neutral', short: 'NEUT', colorKey: 'onSurfaceVariant' },
  'selling': { label: 'Selling', short: 'SELL', colorKey: 'negative' },
  'strong-selling': { label: 'Strong Sell', short: 'S-SELL', colorKey: 'negative' },
  'unknown': { label: 'Unknown', short: 'UNKN', colorKey: 'onSurfaceVariant' },
};

export default function StockTrackerTable({
  entries,
  onSelectEntry,
  onDeleteEntry,
  onNavigateToStock,
  onAlertPress,
  emptyText = 'No tracked stocks found.',
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const isNarrow = width < layout.wideBreakpoint;

  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="stats-chart-outline" size={48} color={colors.onSurfaceVariant} style={{ opacity: 0.5, marginBottom: spacing.md }} />
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.tableCard}>
      <ScrollView horizontal={isNarrow} showsHorizontalScrollIndicator={isNarrow}>
        <View style={styles.tableInner}>
          {/* Header Row */}
          <View style={styles.headerRow}>
            <Text style={[styles.th, styles.colTicker]}>Ticker</Text>
            <Text style={[styles.th, styles.colPrice]}>Price</Text>
            <Text style={[styles.th, styles.colArea]}>Area of Interest</Text>
            <Text style={[styles.th, styles.colMacd]}>MACD Trend</Text>
            <Text style={[styles.th, styles.colFF]}>Foreign Flow</Text>
            <Text style={[styles.th, styles.colCatalyst]}>Event</Text>
            <Text style={[styles.th, styles.colProjection]}>Projection</Text>
            <Text style={[styles.th, styles.colAlert]}>Alert</Text>
            <Text style={[styles.th, styles.colActions]}>Actions</Text>
          </View>

          {/* Table Data Rows */}
          {entries.map((entry, index) => {
            const macd = MACD_CONFIG[entry.weeklyMacdTrend] || MACD_CONFIG.none;
            const ff = FF_CONFIG[entry.foreignFlowSentiment] || FF_CONFIG.unknown;
            const macdColor = colors[macd.colorKey];
            const ffColor = colors[ff.colorKey];

            return (
              <Pressable
                key={entry.id}
                style={({ pressed }) => [
                  styles.tr,
                  index % 2 === 1 && styles.trAlt,
                  pressed && styles.trPressed,
                ]}
                onPress={() => onSelectEntry(entry)}
              >
                {/* Ticker Column */}
                <Pressable
                  style={[styles.td, styles.colTicker]}
                  onPress={() => onNavigateToStock(entry.ticker)}
                  hitSlop={5}
                >
                  <TickerLogo ticker={entry.ticker} fallbackText={entry.ticker.slice(0, 2)} size={32} />
                  <View style={{ marginLeft: spacing.xs }}>
                    <Text style={styles.tickerSymbol}>{entry.ticker}</Text>
                    {entry.notes ? (
                      <Text style={styles.notesHint} numberOfLines={1}>
                        {entry.notes}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>

                {/* Price Column */}
                <View style={[styles.td, styles.colPrice]}>
                  <Text style={styles.priceText}>
                    {entry.currentPrice != null ? `₱${entry.currentPrice.toFixed(2)}` : 'N/A'}
                  </Text>
                </View>

                {/* Area of Interest */}
                <View style={[styles.td, styles.colArea]}>
                  <Text style={styles.cellText} numberOfLines={2}>
                    {entry.areaPriceOfInterest || '—'}
                  </Text>
                </View>

                {/* MACD Trend */}
                <View style={[styles.td, styles.colMacd]}>
                  <View style={[styles.badge, { backgroundColor: macdColor + '18' }]}>
                    <Ionicons name={macd.icon} size={13} color={macdColor} style={{ marginRight: 3 }} />
                    <Text style={[styles.badgeText, { color: macdColor }]}>
                      {entry.weeklyMacdTrend === 'custom' && entry.weeklyMacdTrendCustom
                        ? entry.weeklyMacdTrendCustom
                        : macd.label}
                    </Text>
                  </View>
                </View>

                {/* Foreign Flow Sentiment */}
                <View style={[styles.td, styles.colFF]}>
                  <View style={[styles.badge, { backgroundColor: ffColor + '18' }]}>
                    <Text style={[styles.badgeText, { color: ffColor }]}>{ff.label}</Text>
                  </View>
                </View>

                {/* Event (date + details) */}
                <View style={[styles.td, styles.colCatalyst]}>
                  {!!entry.eventDate && (
                    <Text style={[styles.cellText, { fontWeight: '600' }]} numberOfLines={1}>
                      {entry.eventDate}
                    </Text>
                  )}
                  <Text style={styles.cellText} numberOfLines={2}>
                    {entry.eventCatalyst || (entry.eventDate ? '' : '—')}
                  </Text>
                </View>

                {/* Projection */}
                <View style={[styles.td, styles.colProjection]}>
                  <Text style={styles.cellText} numberOfLines={2}>
                    {entry.projection || '—'}
                  </Text>
                </View>

                {/* Price Alert */}
                <View style={[styles.td, styles.colAlert]}>
                  {entry.linkedAlert ? (
                    <Pressable
                      onPress={() => onAlertPress?.(entry.ticker)}
                      hitSlop={6}
                    >
                      <View style={styles.alertChip}>
                        <Ionicons name="notifications" size={13} color={colors.primary} style={{ marginRight: 3 }} />
                        <Text style={styles.alertChipText}>
                          {entry.linkedAlert.priceThreshold != null
                            ? `${entry.linkedAlert.priceDirection === 'below' ? '<=' : '>='} ₱${entry.linkedAlert.priceThreshold}`
                            : entry.linkedAlert.title}
                        </Text>
                      </View>
                    </Pressable>
                  ) : (
                    <Text style={styles.mutedText}>None</Text>
                  )}
                </View>

                {/* Actions */}
                <View style={[styles.td, styles.colActions, styles.actionsRow]}>
                  <Pressable
                    hitSlop={8}
                    style={styles.actionBtn}
                    onPress={() => onSelectEntry(entry)}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    style={[styles.actionBtn, { marginLeft: spacing.xs }]}
                    onPress={() => onDeleteEntry(entry.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.negative} />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xxl,
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    emptyText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 14,
      color: colors.onSurfaceVariant,
    },
    tableCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    tableInner: {
      minWidth: 980,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    th: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tr: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    trAlt: {
      backgroundColor: colors.surfaceContainerLow,
    },
    trPressed: {
      backgroundColor: colors.primaryContainer + '40',
    },
    td: {
      justifyContent: 'center',
    },
    // Column width definitions
    colTicker: { width: 130 },
    colPrice: { width: 90 },
    colArea: { width: 140 },
    colMacd: { width: 130 },
    colFF: { width: 120 },
    colCatalyst: { width: 140 },
    colProjection: { width: 120 },
    colAlert: { width: 120 },
    colActions: { width: 80, alignItems: 'flex-end' },

    tickerSymbol: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onSurface,
    },
    notesHint: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.onSurfaceVariant,
      maxWidth: 90,
    },
    priceText: {
      fontFamily: fonts.monoBold,
      fontSize: 13,
      color: colors.onSurface,
    },
    cellText: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurface,
      lineHeight: 16,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.default,
    },
    badgeText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
    },
    alertChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primaryContainer,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radii.default,
    },
    alertChipText: {
      fontFamily: fonts.monoSemiBold,
      fontSize: 11,
      color: colors.primary,
    },
    mutedText: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    actionBtn: {
      padding: 4,
    },
  });
}
