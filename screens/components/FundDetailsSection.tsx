// screens/components/FundDetailsSection.tsx
// Fund counterpart to CompanyDetailsSection.tsx (see that file's header
// comment for the loading/not-available/loaded pattern mirrored here) - a
// fund's "profile" is category/bank/ROI from core/fundCache.ts, not a PSE
// company profile (sector/ratios/OHLCV/foreign-flow/ownership), which
// doesn't exist for a fund. Fetches its own copy of the fund cache
// independently of FundDetailScreen's own fetch (same "supplementary
// detail about the ticker, never blocks the rest of the screen" rationale
// as CompanyDetailsSection) - a slow or missing fund cache should never
// hold up NAVPU/positions/transactions above it.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fetchFundCache, getFundPrice, FundEntry } from '../../core/fundCache';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

export default function FundDetailsSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [entry, setEntry] = useState<FundEntry | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntry(null);
    fetchFundCache()
      .then((cache) => {
        if (cancelled) return;
        setEntry(getFundPrice(cache, ticker));
        setGeneratedAt(cache.generatedAt);
      })
      .catch((e) => { console.log('[FundDetailsSection] unexpected error:', e?.message ?? e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.statusText}>Loading fund profile…</Text>
      </View>
    );
  }

  // No entry for this ticker in the fund feed (or the fetch failed) - a
  // quiet one-liner, not a broken section, same collapsing of "not found"
  // and "unreachable" into one outcome as CompanyDetailsSection.
  if (!entry) {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.statusText}>Detailed fund profile isn't available yet for {ticker}.</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.sectionHeader}>Fund Profile</Text>

      <View style={styles.card}>
        <View style={styles.factGrid}>
          <Fact label="Category" value={entry.category} />
          <Fact label="Bank" value={entry.bank} />
          <Fact label="NAVPU" value={`₱${entry.navpu}`} />
          <Fact label="Source" value={entry.source} />
        </View>
      </View>

      <View style={styles.statsGrid}>
        <MiniStat
          label="ROI (YoY)"
          value={entry.roiYoyPct != null ? `${entry.roiYoyPct >= 0 ? '+' : ''}${entry.roiYoyPct}%` : '—'}
          sign={entry.roiYoyPct != null ? (entry.roiYoyPct >= 0 ? 'positive' : 'negative') : undefined}
        />
        <MiniStat
          label="ROI (YTD)"
          value={entry.roiYtdPct != null ? `${entry.roiYtdPct >= 0 ? '+' : ''}${entry.roiYtdPct}%` : '—'}
          sign={entry.roiYtdPct != null ? (entry.roiYtdPct >= 0 ? 'positive' : 'negative') : undefined}
        />
      </View>

      {/* staleAsOf takes precedence over the batch-wide generatedAt when
          set - it's specifically THIS fund's own NAV date, more accurate
          than the batch date for a fund whose cycle lags a day - see
          FundEntry's doc comment in fundCache.ts. */}
      {(entry.staleAsOf || generatedAt) && (
        <Text style={styles.updatedAt}>
          NAVPU as of {(entry.staleAsOf ?? generatedAt)!.split('T')[0]}
          {entry.staleAsOf ? ' · lags the rest of this batch' : ''}
        </Text>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!value) return null;
  return (
    <View style={styles.factItem}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MiniStat({ label, value, sign }: { label: string; value: string; sign?: 'positive' | 'negative' }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={[styles.miniStatValue, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  statusCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  statusText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant },
  sectionHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.xs, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.md,
  },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  factItem: { minWidth: '45%', flexGrow: 1 },
  factLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  factValue: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurface, marginTop: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  miniStat: {
    minWidth: '30%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
  },
  miniStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3 },
  miniStatValue: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  updatedAt: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: spacing.lg },
});
