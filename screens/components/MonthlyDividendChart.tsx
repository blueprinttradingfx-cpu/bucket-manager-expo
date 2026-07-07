// screens/components/MonthlyDividendChart.tsx
// The "Current Year's Monthly Dividend Income" bar chart card shown above
// PositionsTable on both DashboardScreen (aggregated across all buckets)
// and BucketDetailScreen (scoped to one bucket). Plain View-based bars -
// no chart library in this project (see package.json), and a fixed-height
// track with percentage-height children is all 12 simple bars need.
// "View all ->" navigates to MonthlyDividendIncomeScreen, passing the same
// bucket scope (undefined = aggregated, a name = single-bucket) so the two
// screens always agree on what they're showing.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radii, fonts } from '../../core/theme';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRACK_HEIGHT = 90;

/** Just the bars + total line, no card chrome or "View all" link - reused
 *  by MonthlyDividendIncomeScreen's own per-year chart (which sits inside
 *  its own year-tab UI rather than a dashboard summary card). */
export function MonthlyDividendBars({ year, monthlyTotals }: { year: number; monthlyTotals: number[] }) {
  const max = Math.max(...monthlyTotals, 0);
  const total = monthlyTotals.reduce((s, v) => s + v, 0);

  if (total === 0) {
    return <Text style={styles.emptyText}>No dividends declared yet in {year}.</Text>;
  }

  return (
    <>
      <View style={styles.chartRow}>
        {monthlyTotals.map((v, i) => {
          const pct = max > 0 ? Math.round((v / max) * 100) : 0;
          return (
            <View key={i} style={styles.barColumn}>
              <View style={styles.barTrack}>
                {v > 0 && <View style={[styles.bar, { height: `${Math.max(pct, 4)}%` }]} />}
              </View>
              <Text style={styles.barLabel}>{MONTH_ABBR[i]}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.totalLine}>
        Total this year: <Text style={styles.totalValue}>₱{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
      </Text>
    </>
  );
}

export default function MonthlyDividendChart({
  year, monthlyTotals, onViewAll,
}: {
  year: number;
  monthlyTotals: number[]; // length 12, index 0 = January
  onViewAll: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{year}'s Monthly Dividend Income</Text>
        <Pressable onPress={onViewAll} hitSlop={8}>
          <Text style={styles.viewAll}>View all →</Text>
        </Pressable>
      </View>
      <MonthlyDividendBars year={year} monthlyTotals={monthlyTotals} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface },
  viewAll: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: TRACK_HEIGHT + 20 },
  barColumn: { flex: 1, alignItems: 'center' },
  barTrack: {
    width: '60%', height: TRACK_HEIGHT, justifyContent: 'flex-end',
    backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.default, overflow: 'hidden',
  },
  bar: { width: '100%', backgroundColor: colors.positive, borderRadius: radii.default },
  barLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.onSurfaceVariant, marginTop: 4 },
  totalLine: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginTop: spacing.sm },
  totalValue: { fontFamily: fonts.monoSemiBold, color: colors.onSurface },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, paddingVertical: spacing.sm },
});
