// screens/MonthlyDividendIncomeScreen.tsx
// The "View all ->" destination from MonthlyDividendChart, reached from
// both DashboardScreen (route.params.bucket undefined - aggregated across
// every bucket) and BucketDetailScreen (route.params.bucket set - scoped
// to just that one). Registered in both stacks, same as StockInBucketScreen.
//
// Year tabs (newest first, always including the current year even with no
// payments yet) let you flip between calendar years; below the chart is
// every individual CASH DIVIDEND payment for the selected year, grouped by
// month (January first) - the "declared payouts" list.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useStore } from '../core/StoreProvider';
import { DividendPayment, monthlyDividendTotals, dividendYearsAvailable } from '../core/bucketLogic';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { MonthlyDividendBars } from './components/MonthlyDividendChart';
import TickerLogo from './components/TickerLogo';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Minimal structural prop type, not tied to either stack's specific
// NativeStackScreenProps - reachable via two different drill-down paths,
// same convention as StockInBucketScreen.
interface Props {
  route: { params: { bucket?: string } };
}

export default function MonthlyDividendIncomeScreen({ route }: Props) {
  const { bucket } = route.params ?? {};
  useScreenViewLog('MonthlyDividendIncome', { bucket: bucket ?? 'all' });
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const [payments, setPayments] = useState<DividendPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');

  useEffect(() => {
    (async () => {
      const feed = await store.getDividendFeed(bucket);
      setPayments(feed);
      setLoading(false);
    })();
  }, [store, bucket]);

  const years = useMemo(() => dividendYearsAvailable(payments, currentYear), [payments, currentYear]);
  const monthlyTotals = useMemo(() => monthlyDividendTotals(payments, selectedYear), [payments, selectedYear]);

  const paymentsByMonth = useMemo(() => {
    const byMonth = new Map<number, DividendPayment[]>();
    for (const p of payments) {
      const [y, m] = p.date.split('-');
      if (Number(y) !== selectedYear) continue;
      const month = Number(m);
      const list = byMonth.get(month) ?? [];
      list.push(p);
      byMonth.set(month, list);
    }
    for (const list of byMonth.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return byMonth;
  }, [payments, selectedYear]);

  // Gallery view only needs "which tickers paid this month", not the full
  // itemized entries paymentsByMonth carries (amounts/dates/buckets) - a
  // stock that paid into multiple buckets in the same month should still
  // show just one logo, not one per bucket.
  const tickersByMonth = useMemo(() => {
    const byMonth = new Map<number, string[]>();
    for (let month = 1; month <= 12; month++) {
      const entries = paymentsByMonth.get(month) ?? [];
      byMonth.set(month, Array.from(new Set(entries.map((e) => e.ticker))).sort());
    }
    return byMonth;
  }, [paymentsByMonth]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Monthly Dividend Income</Text>
      <Text style={styles.subtitle}>{bucket ? `Scoped to ${bucket}` : 'Aggregated across all buckets'}</Text>

      <View style={styles.yearTabs}>
        {years.map((y) => (
          <Pressable key={y} onPress={() => setSelectedYear(y)} style={[styles.yearTab, y === selectedYear && styles.yearTabActive]}>
            <Text style={[styles.yearTabText, y === selectedYear && styles.yearTabTextActive]}>{y}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.chartCard}>
        <MonthlyDividendBars year={selectedYear} monthlyTotals={monthlyTotals} />
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>Declared Payouts</Text>
        <View style={styles.viewModeTrack}>
          <Pressable style={[styles.viewModeButton, viewMode === 'list' && styles.viewModeButtonActive]} onPress={() => setViewMode('list')}>
            <Text style={[styles.viewModeButtonText, viewMode === 'list' && styles.viewModeButtonTextActive]}>List</Text>
          </Pressable>
          <Pressable style={[styles.viewModeButton, viewMode === 'gallery' && styles.viewModeButtonActive]} onPress={() => setViewMode('gallery')}>
            <Text style={[styles.viewModeButtonText, viewMode === 'gallery' && styles.viewModeButtonTextActive]}>Gallery</Text>
          </Pressable>
        </View>
      </View>

      {monthlyTotals.every((v) => v === 0) ? (
        <Text style={styles.emptyText}>No dividends declared in {selectedYear}.</Text>
      ) : viewMode === 'gallery' ? (
        // Calendar-style overview: all 12 months always shown (unlike list
        // view, which skips empty ones) so you can see at a glance which
        // months are quiet vs busy - each month's logos are the tickers
        // that declared a payout then, deduped across buckets.
        <View style={styles.galleryGrid}>
          {MONTH_NAMES.map((name, i) => {
            const month = i + 1;
            const tickers = tickersByMonth.get(month) ?? [];
            return (
              <View key={month} style={styles.galleryCell}>
                <Text style={styles.galleryMonthLabel}>{name.slice(0, 3).toUpperCase()}</Text>
                {tickers.length === 0 ? (
                  <Text style={styles.galleryEmpty}>—</Text>
                ) : (
                  <View style={styles.galleryLogos}>
                    {tickers.map((ticker) => (
                      <TickerLogo key={ticker} ticker={ticker} fallbackText={ticker.slice(0, 2)} size={26} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        MONTH_NAMES.map((name, i) => {
          const month = i + 1;
          const entries = paymentsByMonth.get(month) ?? [];
          if (entries.length === 0) return null;
          const monthTotal = entries.reduce((s, e) => s + e.amount, 0);
          return (
            <View key={month} style={styles.monthCard}>
              <View style={styles.monthHeaderRow}>
                <Text style={styles.monthTitle}>{name} {selectedYear}</Text>
                <Text style={styles.monthTotal}>₱{monthTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
              </View>
              {entries.map((e, idx) => (
                <View key={idx} style={styles.payoutRow}>
                  <View>
                    <Text style={styles.payoutTicker}>{e.ticker}</Text>
                    {!bucket && <Text style={styles.payoutBucket}>{e.bucket}</Text>}
                  </View>
                  <View style={styles.payoutRight}>
                    <Text style={styles.payoutAmount}>₱{e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    <Text style={styles.payoutDate}>{e.date}</Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: 2 },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  yearTabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  yearTab: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.full,
    borderWidth: 1, borderColor: colors.outlineVariant, backgroundColor: colors.surface,
  },
  yearTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  yearTabText: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurfaceVariant },
  yearTabTextActive: { color: colors.onPrimary },
  chartCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionHeader: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface },
  viewModeTrack: { flexDirection: 'row', backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.lg, padding: 2 },
  viewModeButton: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.lg - 1 },
  viewModeButtonActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  viewModeButtonText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  viewModeButtonTextActive: { fontFamily: fonts.bodyBold, color: colors.primary },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  galleryCell: {
    width: '31%', marginBottom: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.sm, minHeight: 92,
  },
  galleryMonthLabel: {
    fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: spacing.xs,
  },
  galleryLogos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  galleryEmpty: { fontFamily: fonts.body, fontSize: 13, color: colors.outline },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, paddingVertical: spacing.sm },
  monthCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.sm,
  },
  monthHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  monthTitle: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.3 },
  monthTotal: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.positive },
  payoutRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.outlineVariant,
  },
  payoutTicker: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurface },
  payoutBucket: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 1 },
  payoutRight: { alignItems: 'flex-end' },
  payoutAmount: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
  payoutDate: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 1 },
});
