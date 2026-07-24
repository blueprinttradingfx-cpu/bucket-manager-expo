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

      <Text style={styles.sectionHeader}>Declared Payouts</Text>

      {monthlyTotals.every((v) => v === 0) ? (
        <Text style={styles.emptyText}>No dividends declared in {selectedYear}.</Text>
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
  sectionHeader: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: spacing.sm },
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
