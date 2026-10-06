// screens/MarketPulseScreen.tsx
// Market-wide context (PSEi, sentiment, movers, most-active, 52-week
// ranges, dividends/macro calendars) - a different concern from the rest
// of DashboardStack, which is entirely portfolio-scoped. Reached by
// tapping MarketPulseCard on Dashboard, same "compact card -> dedicated
// screen" pattern MonthlyDividendChart/MonthlyDividendIncomeScreen
// already use.
//
// Two independent upstream feeds (see marketPulseCache.ts's header
// comment for why), fetched with Promise.allSettled so one being down
// never blocks the other's section from rendering - same posture as
// DashboardScreen's own price/fund cache fetch.
//
// keyEconomicIndicators is deliberately not rendered here - it's empty in
// every generated file seen so far. If the upstream generator starts
// populating it, add a section following the same "hide if empty" rule
// as everything else on this screen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, ActivityIndicator, StyleSheet, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchMarketPulse, fetchDividendsMacroCalendar, isMarketPulseStale,
  MarketPulseData, DividendsMacroData, MoverStock, MostActiveStock, WeekRangeStock,
  DividendCalendarEntry, MacroEvent,
} from '../core/marketPulseCache';
import { DashboardStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { useAuth } from '../core/AuthProvider';
import { ADMIN_USER_UIDS } from '../core/adminConfig';
import TickerLogo from './components/TickerLogo';

type Props = NativeStackScreenProps<DashboardStackParamList, 'MarketPulse'>;

export default function MarketPulseScreen({ navigation }: Props) {
  useScreenViewLog('MarketPulse');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const isAdmin = Boolean(user?.uid && ADMIN_USER_UIDS.includes(user.uid));

  const [pulse, setPulse] = useState<MarketPulseData | null>(null);
  const [divMacro, setDivMacro] = useState<DividendsMacroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moversTab, setMoversTab] = useState<'gainers' | 'losers'>('gainers');
  const [activeTab, setActiveTab] = useState<'value' | 'volume'>('value');
  const [weekTab, setWeekTab] = useState<'nearHigh' | 'nearLow' | 'crossedHigh' | 'crossedLow'>('nearHigh');

  const handleOpenMarketShackSectors = useCallback(() => {
    const url = 'https://marketshack.ph/market/sectors';
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener');
    } else {
      Linking.openURL(url);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const [pulseResult, divMacroResult] = await Promise.allSettled([
      fetchMarketPulse(undefined, { force }),
      fetchDividendsMacroCalendar(undefined, { force }),
    ]);
    setPulse(pulseResult.status === 'fulfilled' ? pulseResult.value : null);
    setDivMacro(divMacroResult.status === 'fulfilled' ? divMacroResult.value : null);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true).finally(() => setRefreshing(false));
  }, [load]);

  const goToTicker = useCallback((ticker: string) => {
    navigation.navigate('StockDetail', { ticker });
  }, [navigation]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!pulse && !divMacro) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Text style={styles.emptyText}>Market data isn't available right now. Pull down to try again.</Text>
      </View>
    );
  }

  const weekLists: Record<typeof weekTab, WeekRangeStock[]> = pulse ? {
    nearHigh: pulse.near52WeekHigh,
    nearLow: pulse.near52WeekLow,
    crossedHigh: pulse.crossed52WeekHigh,
    crossedLow: pulse.crossed52WeekLow,
  } : { nearHigh: [], nearLow: [], crossedHigh: [], crossedLow: [] };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {isAdmin && (
        <Pressable style={styles.adminCard} onPress={handleOpenMarketShackSectors}>
          <View style={styles.adminIconWrap}>
            <Ionicons name="pie-chart-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.adminTitleRow}>
              <Text style={styles.adminTitle}>Sector Performance</Text>
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>Wilbert</Text>
              </View>
            </View>
            <Text style={styles.adminSubtitle}>View sector breakdown on MarketShack</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      )}

      {pulse && <PulseHeader pulse={pulse} colors={colors} styles={styles} />}

      {pulse && (
        <Section title="Market Movers" colors={colors} styles={styles}>
          <SegmentedTabs
            options={[{ key: 'gainers', label: 'Gainers' }, { key: 'losers', label: 'Losers' }]}
            active={moversTab}
            onChange={(k) => setMoversTab(k as typeof moversTab)}
            colors={colors} styles={styles}
          />
          {(moversTab === 'gainers' ? pulse.marketMovers.topGainers : pulse.marketMovers.topLosers).map((m) => (
            <MoverRow key={m.symbol} mover={m} onPress={() => goToTicker(m.symbol)} colors={colors} styles={styles} />
          ))}
        </Section>
      )}

      {pulse && (
        <Section title="Most Active" colors={colors} styles={styles}>
          <SegmentedTabs
            options={[{ key: 'value', label: 'By Value' }, { key: 'volume', label: 'By Volume' }]}
            active={activeTab}
            onChange={(k) => setActiveTab(k as typeof activeTab)}
            colors={colors} styles={styles}
          />
          {(activeTab === 'value' ? pulse.mostActive.byValue : pulse.mostActive.byVolume).map((m) => (
            <MostActiveRow key={m.symbol} stock={m} onPress={() => goToTicker(m.symbol)} colors={colors} styles={styles} />
          ))}
        </Section>
      )}

      {pulse && (
        <Section title="52-Week Range" colors={colors} styles={styles}>
          <SegmentedTabs
            options={[
              { key: 'nearHigh', label: 'Near High' }, { key: 'nearLow', label: 'Near Low' },
              { key: 'crossedHigh', label: 'Crossed High' }, { key: 'crossedLow', label: 'Crossed Low' },
            ]}
            active={weekTab}
            onChange={(k) => setWeekTab(k as typeof weekTab)}
            colors={colors} styles={styles}
          />
          {weekLists[weekTab].length === 0 ? (
            <Text style={styles.emptySection}>None right now.</Text>
          ) : weekLists[weekTab].map((w) => (
            <WeekRangeRow key={w.symbol} stock={w} onPress={() => goToTicker(w.symbol)} colors={colors} styles={styles} />
          ))}
        </Section>
      )}

      {divMacro && divMacro.dividends.length > 0 && (
        <Section title="Dividends Calendar" colors={colors} styles={styles}>
          {divMacro.dividends.map((d, i) => (
            <DividendRow key={`${d.ticker}-${i}`} entry={d} onPress={() => goToTicker(d.ticker)} colors={colors} styles={styles} />
          ))}
        </Section>
      )}

      {divMacro && divMacro.macro.length > 0 && (
        <Section title="Macro Calendar" colors={colors} styles={styles}>
          {divMacro.macro.map((m, i) => (
            <MacroRow key={`${m.date}-${i}`} event={m} colors={colors} styles={styles} />
          ))}
        </Section>
      )}

      {pulse && (
        <Text style={styles.generatedAt}>
          Updated {new Date(pulse.generatedAt).toLocaleString()}
          {isMarketPulseStale(pulse) ? ' · data may be out of date' : ''}
        </Text>
      )}
    </ScrollView>
  );
}

// --- Header ---------------------------------------------------------------

function PulseHeader({ pulse, colors, styles }: { pulse: MarketPulseData; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  const { psei, rsi, marketSentiment } = pulse.marketPulse;
  const positive = psei.changePercent >= 0;
  const sentimentLabel = marketSentiment.bbr > 55 ? 'Bullish' : marketSentiment.bbr < 45 ? 'Bearish' : 'Neutral';
  const sentimentColor = marketSentiment.bbr > 55 ? colors.positive : marketSentiment.bbr < 45 ? colors.negative : colors.onSurfaceVariant;
  return (
    <View style={styles.headerCard}>
      <Text style={styles.headerLabel}>PSEi</Text>
      <Text style={styles.headerValue}>{psei.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
      <Text style={[styles.headerChange, { color: positive ? colors.positive : colors.negative }]}>
        {positive ? '+' : ''}{psei.changePrice.toFixed(2)} ({positive ? '+' : ''}{psei.changePercent.toFixed(2)}%) · YTD {psei.ytdReturnPercent >= 0 ? '+' : ''}{psei.ytdReturnPercent.toFixed(2)}%
      </Text>
      <View style={styles.headerStatsRow}>
        <View style={styles.headerStat}>
          <Text style={styles.headerStatLabel}>RSI</Text>
          <Text style={styles.headerStatValue}>{rsi.value.toFixed(1)}</Text>
        </View>
        <View style={styles.headerStat}>
          <Text style={styles.headerStatLabel}>Bull/Bear Ratio</Text>
          <Text style={[styles.headerStatValue, { color: sentimentColor }]}>{marketSentiment.bbr.toFixed(1)} · {sentimentLabel}</Text>
        </View>
        <View style={styles.headerStat}>
          <Text style={styles.headerStatLabel}>Volume</Text>
          <Text style={styles.headerStatValue}>{(psei.volumeAll / 1_000_000).toFixed(1)}M</Text>
        </View>
      </View>
    </View>
  );
}

// --- Shared section chrome --------------------------------------------------

function Section({ title, colors, styles, children }: { title: string; colors: ThemeColors; styles: ReturnType<typeof createStyles>; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SegmentedTabs({ options, active, onChange, colors, styles }: {
  options: { key: string; label: string }[]; active: string; onChange: (key: string) => void;
  colors: ThemeColors; styles: ReturnType<typeof createStyles>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabTrackScroll}>
      <View style={styles.tabTrack}>
        {options.map((o) => (
          <Pressable key={o.key} style={[styles.tabButton, active === o.key && styles.tabButtonActive]} onPress={() => onChange(o.key)}>
            <Text style={[styles.tabButtonText, active === o.key && styles.tabButtonTextActive]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// --- Rows -------------------------------------------------------------------

function MoverRow({ mover, onPress, colors, styles }: { mover: MoverStock; onPress: () => void; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  const positive = mover.changePercent >= 0;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <TickerLogo ticker={mover.symbol} fallbackText={mover.symbol.slice(0, 2)} size={32} />
      <View style={styles.rowMain}>
        <Text style={styles.rowSymbol}>{mover.symbol}</Text>
        <Text style={styles.rowName} numberOfLines={1}>{mover.name}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text style={styles.rowPrice}>₱{mover.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
        <Text style={[styles.rowChange, { color: positive ? colors.positive : colors.negative }]}>
          {positive ? '+' : ''}{mover.changePercent.toFixed(2)}%
        </Text>
      </View>
    </Pressable>
  );
}

function MostActiveRow({ stock, onPress, colors, styles }: { stock: MostActiveStock; onPress: () => void; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  const positive = stock.changePercent >= 0;
  const stat = stock.turnover != null
    ? `₱${(stock.turnover / 1_000_000).toFixed(1)}M`
    : stock.volume != null ? `${(stock.volume / 1_000_000).toFixed(2)}M sh` : '—';
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <TickerLogo ticker={stock.symbol} fallbackText={stock.symbol.slice(0, 2)} size={32} />
      <View style={styles.rowMain}>
        <Text style={styles.rowSymbol}>{stock.symbol}</Text>
        <Text style={styles.rowName} numberOfLines={1}>{stock.name}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text style={styles.rowPrice}>{stat}</Text>
        <Text style={[styles.rowChange, { color: positive ? colors.positive : colors.negative }]}>
          {positive ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </Text>
      </View>
    </Pressable>
  );
}

function WeekRangeRow({ stock, onPress, colors, styles }: { stock: WeekRangeStock; onPress: () => void; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <TickerLogo ticker={stock.symbol} fallbackText={stock.symbol.slice(0, 2)} size={32} />
      <View style={styles.rowMain}>
        <Text style={styles.rowSymbol}>{stock.symbol}</Text>
        <Text style={styles.rowName}>52-wk: ₱{stock.week52.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text style={styles.rowPrice}>₱{stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
        {stock.week52Percent != null && (
          <Text style={styles.rowChange}>{stock.week52Percent.toFixed(2)}% away</Text>
        )}
      </View>
    </Pressable>
  );
}

function DividendRow({ entry, onPress, colors, styles }: { entry: DividendCalendarEntry; onPress: () => void; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <TickerLogo ticker={entry.ticker} fallbackText={entry.ticker.slice(0, 2)} size={32} />
      <View style={styles.rowMain}>
        <Text style={styles.rowSymbol}>{entry.ticker}</Text>
        <Text style={styles.rowName}>Ex-date {entry.exDate}</Text>
      </View>
      <Text style={styles.rowPrice}>{entry.amount}</Text>
    </Pressable>
  );
}

function MacroRow({ event, colors, styles }: { event: MacroEvent; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroDateBadge}>
        <Text style={styles.macroDateText}>{new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowSymbol}>{event.label}</Text>
        <Text style={styles.rowName}>{event.market} · {event.type}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  centerFill: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.lg },
  emptySection: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, paddingVertical: spacing.sm },

  headerCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  headerLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  headerValue: { fontFamily: fonts.monoBold, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  headerChange: { fontFamily: fonts.mono, fontSize: 14, marginTop: 4 },
  headerStatsRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  headerStat: {},
  headerStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  headerStatValue: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface, marginTop: 2 },

  section: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  sectionTitle: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },

  tabTrackScroll: { marginBottom: spacing.sm },
  tabTrack: { flexDirection: 'row', backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.lg, padding: 2 },
  tabButton: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.lg - 1 },
  tabButtonActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabButtonText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  tabButtonTextActive: { fontFamily: fonts.bodyBold, color: colors.primary },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  rowMain: { flex: 1, minWidth: 0 },
  rowSymbol: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  rowName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 1 },
  rowTrailing: { alignItems: 'flex-end' },
  rowPrice: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
  rowChange: { fontFamily: fonts.mono, fontSize: 12, marginTop: 1 },

  macroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  macroDateBadge: { backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.default, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  macroDateText: { fontFamily: fonts.monoSemiBold, fontSize: 12, color: colors.onSurface },

  generatedAt: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: spacing.sm },

  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.primary + '50',
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  adminIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  adminTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  adminSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  adminBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: radii.full,
  },
  adminBadgeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.onPrimary,
  },
});
