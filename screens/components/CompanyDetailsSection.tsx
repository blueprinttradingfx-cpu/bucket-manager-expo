// screens/components/CompanyDetailsSection.tsx
// The rich "company profile" block on StockDetailScreen, sourced from the
// per-ticker company-details JSON (core/companyDetailsCache.ts) - separate
// from this app's own portfolio data (positions, transactions), which is
// why it fetches independently here rather than blocking StockDetailScreen's
// own loading state: this is supplementary detail about the STOCK, not
// about the user's holdings in it, so a slow or missing company-details
// file should never hold up or break the rest of the screen.
//
// Three render states: loading (brief, this is a small JSON file), not
// available (ticker has no company-details file yet, or the fetch failed -
// same visual treatment either way, see companyDetailsCache's doc comment
// for why those are collapsed into one "null" outcome), and loaded.
//
// No chart library in this project (see package.json) - PriceChart and
// ForeignFlowChart are plain react-native-svg, same approach as the
// circular gauge in PassiveIncomeGoalCard.tsx.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Polyline, Line, Rect } from 'react-native-svg';
import {
  fetchCompanyDetails, CompanyDetails, OhlcvBar, ForeignFlowDay,
  DividendRecord, TopHolder, OwnershipChange,
} from '../../core/companyDetailsCache';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

const CHART_WIDTH = 320;

export default function CompanyDetailsSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [details, setDetails] = useState<CompanyDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    fetchCompanyDetails(ticker)
      .then((data) => { if (!cancelled) setDetails(data); })
      .catch((e) => { console.log('[CompanyDetailsSection] unexpected error:', e?.message ?? e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.statusText}>Loading company profile…</Text>
      </View>
    );
  }

  // The catch this feature needs: no file for this ticker yet (or it
  // couldn't be reached) - a quiet one-liner, not a broken section.
  if (!details) {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.statusText}>Detailed company profile isn't available yet for {ticker}.</Text>
      </View>
    );
  }

  const { company, ratios } = details;
  const recentOhlcv = details.ohlcv?.slice(-120) ?? []; // ~6 months of sessions - enough shape, still readable
  const orderedFlow = [...(details.foreign_flow_30d ?? [])].reverse(); // source is newest-first; chart reads oldest→newest

  return (
    <View>
      <Text style={styles.sectionHeader}>Company Profile</Text>

      <View style={styles.card}>
        {!!company.description && <Text style={styles.description}>{company.description}</Text>}
        <View style={styles.factGrid}>
          <Fact label="Sector" value={company.sector} />
          <Fact label="Sub-sector" value={company.pse_subsector} />
          <Fact label="Listed" value={company.listing_date} />
          <Fact label="Incorporated" value={company.incorporation_date} />
          <Fact label="ISIN" value={company.isin} />
          <Fact label="Par Value" value={company.par_value != null ? `₱${company.par_value}` : null} />
          <Fact label="Board Lot" value={company.board_lot != null ? company.board_lot.toLocaleString() : null} />
          <Fact label="Foreign Limit" value={company.foreign_limit_pct != null ? `${company.foreign_limit_pct}%` : null} />
          <Fact label="Fiscal Year" value={company.fiscal_year} />
          <Fact label="Auditor" value={company.external_auditor} />
        </View>
      </View>

      <View style={styles.statsGrid}>
        <MiniStat label="Market Cap" value={company.market_cap != null ? `₱${formatCompact(company.market_cap)}` : '—'} />
        <MiniStat label="P/E" value={ratios?.pe != null ? ratios.pe.toFixed(2) : '—'} />
        <MiniStat label="P/BV" value={ratios?.pbv != null ? ratios.pbv.toFixed(2) : '—'} />
        <MiniStat label="ROE" value={ratios?.roe != null ? `${ratios.roe}%` : '—'} />
        <MiniStat label="Net Margin" value={ratios?.netMargin != null ? `${ratios.netMargin}%` : '—'} />
        <MiniStat label="Div Yield" value={details.dividend_yield != null ? `${details.dividend_yield}%` : '—'} />
        <MiniStat label="52W High" value={company.high_52w != null ? `₱${company.high_52w}` : '—'} />
        <MiniStat label="52W Low" value={company.low_52w != null ? `₱${company.low_52w}` : '—'} />
        <MiniStat label="Free Float" value={company.free_float_pct != null ? `${company.free_float_pct}%` : '—'} />
      </View>

      {recentOhlcv.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Price History</Text>
          <PriceChart bars={recentOhlcv} colors={colors} />
        </View>
      )}

      {orderedFlow.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Foreign Flow (30D)</Text>
            {details.net_foreign_30d != null && (
              <Text style={[styles.netFlowValue, details.net_foreign_30d >= 0 ? styles.positive : styles.negative]}>
                {details.net_foreign_30d >= 0 ? '+' : ''}₱{formatCompact(details.net_foreign_30d)}
              </Text>
            )}
          </View>
          <ForeignFlowChart days={orderedFlow} colors={colors} />
        </View>
      )}

      {details.dividends?.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.cardTitle}>Dividend History</Text>
          <DividendHistoryTable rows={details.dividends} />
        </View>
      )}

      {details.top_holders?.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.cardTitle}>Top Holders</Text>
          <TopHoldersList holders={details.top_holders} />
        </View>
      )}

      {details.ownership_changes?.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.cardTitle}>Notable Ownership Changes</Text>
          <OwnershipChangesList changes={details.ownership_changes} />
        </View>
      )}

      {!!company.updated_at && (
        <Text style={styles.updatedAt}>Company data as of {company.updated_at.split('T')[0]}</Text>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={styles.miniStatValue}>{value}</Text>
    </View>
  );
}

function PriceChart({ bars, colors }: { bars: OhlcvBar[]; colors: ThemeColors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const height = 110;
  const padding = 4;
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const points = bars
    .map((b, i) => {
      const x = padding + (i / Math.max(bars.length - 1, 1)) * (CHART_WIDTH - padding * 2);
      const y = padding + (1 - (b.close - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = bars[bars.length - 1].close >= bars[0].close;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${CHART_WIDTH} ${height}`} preserveAspectRatio="none">
        <Polyline points={points} fill="none" stroke={up ? colors.positive : colors.negative} strokeWidth={2} />
      </Svg>
      <View style={styles.chartRangeRow}>
        <Text style={styles.chartRangeText}>₱{min.toFixed(2)}</Text>
        <Text style={styles.chartRangeText}>{bars.length} sessions</Text>
        <Text style={styles.chartRangeText}>₱{max.toFixed(2)}</Text>
      </View>
    </View>
  );
}

function ForeignFlowChart({ days, colors }: { days: ForeignFlowDay[]; colors: ThemeColors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const height = 90;
  const midY = height / 2;
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.net_foreign)), 1);
  const barGap = 1;
  const barWidth = CHART_WIDTH / days.length;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${CHART_WIDTH} ${height}`} preserveAspectRatio="none">
        <Line x1={0} y1={midY} x2={CHART_WIDTH} y2={midY} stroke={colors.outlineVariant} strokeWidth={1} />
        {days.map((d, i) => {
          const barHeight = Math.max((Math.abs(d.net_foreign) / maxAbs) * (height / 2 - 4), 0.5);
          const x = i * barWidth + barGap / 2;
          const y = d.net_foreign >= 0 ? midY - barHeight : midY;
          return (
            <Rect
              key={d.trade_date}
              x={x} y={y}
              width={Math.max(barWidth - barGap, 1)} height={barHeight}
              fill={d.net_foreign >= 0 ? colors.positive : colors.negative}
            />
          );
        })}
      </Svg>
      <View style={styles.chartRangeRow}>
        <Text style={styles.chartRangeText}>{days[0]?.trade_date}</Text>
        <Text style={styles.chartRangeText}>{days[days.length - 1]?.trade_date}</Text>
      </View>
    </View>
  );
}

const DIVIDENDS_COLLAPSED_COUNT = 6;

function DividendHistoryTable({ rows }: { rows: DividendRecord[] }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, DIVIDENDS_COLLAPSED_COUNT);

  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <Text style={[styles.tableHeaderText, styles.divColAmount]}>Amount</Text>
        <Text style={[styles.tableHeaderText, styles.divColDate]}>Ex-Date</Text>
        <Text style={[styles.tableHeaderText, styles.divColDate]}>Payment</Text>
      </View>
      {visible.map((d, i) => (
        <View key={`${d.exDate}-${i}`} style={[styles.tableRow, styles.tableDataRow]}>
          <View style={styles.divColAmount}>
            <Text style={styles.tableCellText}>{d.amount}</Text>
            {d.isPreferred && <Text style={styles.prefTag}>Preferred</Text>}
          </View>
          <Text style={[styles.tableCellText, styles.divColDate]}>{d.exDate}</Text>
          <Text style={[styles.tableCellText, styles.divColDate]}>{d.paymentDate}</Text>
        </View>
      ))}
      {rows.length > DIVIDENDS_COLLAPSED_COUNT && (
        <Pressable style={styles.showMoreRow} onPress={() => setExpanded((e) => !e)} hitSlop={8}>
          <Text style={styles.showMoreText}>{expanded ? 'Show less' : `Show all ${rows.length} →`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function TopHoldersList({ holders }: { holders: TopHolder[] }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const max = Math.max(...holders.map((h) => h.pct_outstanding), 1);

  return (
    <View style={styles.table}>
      {holders.map((h, i) => (
        <View key={`${h.name}-${i}`} style={[styles.holderRow, i > 0 && styles.tableDataRow]}>
          <View style={styles.holderInfo}>
            <Text style={styles.holderName} numberOfLines={1}>{h.name}</Text>
            <View style={styles.holderBarTrack}>
              <View style={[styles.holderBarFill, { width: `${Math.max((h.pct_outstanding / max) * 100, 3)}%` }]} />
            </View>
          </View>
          <Text style={styles.holderPct}>{h.pct_outstanding}%</Text>
        </View>
      ))}
    </View>
  );
}

const OWNERSHIP_CHANGES_SHOWN = 6;

function OwnershipChangesList({ changes }: { changes: OwnershipChange[] }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Biggest movers first, regardless of direction - change_shares is always
  // a reliable number (unlike change_pct, which is occasionally a "$-0"
  // string in the source data for near-zero changes).
  const top = [...changes]
    .sort((a, b) => Math.abs(b.change_shares) - Math.abs(a.change_shares))
    .slice(0, OWNERSHIP_CHANGES_SHOWN);

  return (
    <View style={styles.table}>
      {top.map((c, i) => {
        const increased = c.change_shares >= 0;
        const pct = typeof c.change_pct === 'number' && Number.isFinite(c.change_pct) ? c.change_pct : null;
        return (
          <View key={`${c.name}-${i}`} style={[styles.tableRow, i > 0 && styles.tableDataRow]}>
            <Text style={[styles.tableCellText, styles.ownerColName]} numberOfLines={1}>{c.name}</Text>
            <View style={styles.ownerColChange}>
              <Text style={[styles.tableCellText, increased ? styles.positive : styles.negative]}>
                {increased ? '+' : ''}{c.change_shares.toLocaleString()}
              </Text>
              {pct != null && (
                <Text style={[styles.ownerPct, increased ? styles.positive : styles.negative]}>
                  {pct >= 0 ? '+' : ''}{pct}%
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
  description: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.onSurface, marginBottom: spacing.sm },
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
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface, marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  netFlowValue: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  chartRangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  chartRangeText: { fontFamily: fonts.mono, fontSize: 10, color: colors.onSurfaceVariant },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  table: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, overflow: 'hidden',
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.md },
  tableDataRow: { borderTopWidth: 1, borderTopColor: colors.outlineVariant },
  tableHeaderText: {
    fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  tableCellText: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
  divColAmount: { flex: 1 },
  divColDate: { flex: 1, textAlign: 'right' },
  prefTag: {
    fontFamily: fonts.bodySemiBold, fontSize: 9, color: colors.primary, marginTop: 2,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  showMoreRow: { paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineVariant, alignItems: 'center' },
  showMoreText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  holderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.md, gap: spacing.sm },
  holderInfo: { flex: 1 },
  holderName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurface, marginBottom: 4 },
  holderBarTrack: { height: 4, borderRadius: radii.default, backgroundColor: colors.surfaceContainerHighest, overflow: 'hidden' },
  holderBarFill: { height: 4, backgroundColor: colors.primary, borderRadius: radii.default },
  holderPct: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurface, minWidth: 44, textAlign: 'right' },
  ownerColName: { flex: 1.4, paddingRight: spacing.sm },
  ownerColChange: { flex: 1, alignItems: 'flex-end' },
  ownerPct: { fontFamily: fonts.mono, fontSize: 11, marginTop: 2 },
  updatedAt: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: spacing.lg },
});
