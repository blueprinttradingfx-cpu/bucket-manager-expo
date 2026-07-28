// screens/FundDetailScreen.tsx
// Fund counterpart to StockDetailScreen (see that file's header comment for
// the full drill-down rationale) - one fund ticker, merged across every
// bucket that holds it. Split into its own screen/route (/fund/:ticker,
// vs StockDetail's /stock/:ticker) rather than sharing StockDetailScreen,
// because a fund's live pricing comes from a different feed (fundCache.ts's
// NAVPU, not priceCache.ts's stock price) and its "profile" data is
// fundamentally different too - category/bank/ROI (FundDetailsSection)
// instead of a PSE company profile with OHLCV/foreign-flow/ownership data
// (CompanyDetailsSection), which simply doesn't exist for a fund. No
// BucketSuggestion here either: that card matches a ticker's dividend
// yield against bucket brackets, and a fund's yieldPct is always null (see
// fundCacheToPriceLookup) - showing it would just be a permanently-dead
// "no yield data" message on every fund, not a useful widget.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable, StyleProp, ViewStyle } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Alert from '../core/alert';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, ValuedAggregatedStock, ValuedStockPosition, BucketStockPosition, applyPricesToAggregated } from '../core/bucketLogic';
import { WatchlistItem } from '../core/storeApi';
import { fetchFundCache, fundCacheToPriceLookup, FundEntry, getFundPrice } from '../core/fundCache';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import WatchlistSection from './components/WatchlistSection';
import FundDetailsSection from './components/FundDetailsSection';

// Same minimal structural prop type as StockDetailScreen - this screen is
// only registered in DashboardStack for now (Dashboard > Positions is the
// only place that currently distinguishes fund rows from stock rows before
// navigating), and it only ever calls 'StockInBucket', which every stack
// declares identically.
interface Props {
  route: { params: { ticker: string } };
  navigation: { navigate: (screen: 'StockInBucket', params: { bucket: string; ticker: string }) => void };
}

type BucketPositionRow = ValuedStockPosition | BucketStockPosition;

interface TickerTxnRow {
  bucket: string;
  date: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
}
type TxnSortKey = 'bucket' | 'date' | 'price';

function isValuedPosition(p: BucketPositionRow): p is ValuedStockPosition {
  return 'marketValue' in p;
}

function toPositionItem(item: BucketPositionRow, colors: ThemeColors): PositionItem {
  const valued = isValuedPosition(item) ? item : null;
  return {
    key: item.bucket,
    label: item.bucket,
    badgeText: item.bucket.slice(0, 2).toUpperCase(),
    badgeVariant: 'neutral',
    qty: item.totalQty,
    avgCost: item.avgCost,
    costBasis: item.totalCostBasis,
    dividends: item.totalDividends,
    currentPrice: valued?.currentPrice ?? null,
    marketValue: valued?.marketValue ?? null,
    unrealizedGain: valued?.unrealizedGain ?? null,
    unrealizedGainPct: valued?.unrealizedGainPct ?? null,
    pendingSettlement: item.pendingSettlement,
    expandedContent: (
      <>
        {item.totalQty <= 0 && !item.pendingSettlement && (
          <ExpandedRow label="Status" value="Fully sold in this bucket" />
        )}
        {item.pendingSettlement && (
          <ExpandedRow label="Status" value="Awaiting NAVPU from statement" />
        )}
        <ExpandedRow label="Market Value" value={`₱${(valued?.marketValue ?? item.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <ExpandedRow label="Avg Cost" value={`₱${item.avgCost}`} />
        <ExpandedRow label="Open Lots" value={String(item.openLots)} />
        <ExpandedRow label="Realized Gain" value={`${item.realizedGain >= 0 ? '+' : ''}₱${item.realizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} valueStyle={item.realizedGain !== 0 ? { color: item.realizedGain > 0 ? colors.positive : colors.negative } : undefined} />
        <ExpandedRow label="Dividends Earned" value={`₱${item.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} valueStyle={item.totalDividends > 0 ? { color: colors.positive } : undefined} />
      </>
    ),
  };
}

export default function FundDetailScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
  useScreenViewLog('FundDetail', { ticker });
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const [stock, setStock] = useState<AggregatedStock | ValuedAggregatedStock | null>(null);
  const [fundEntry, setFundEntry] = useState<FundEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlistItem, setWatchlistItem] = useState<WatchlistItem | null>(null);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [txnHistory, setTxnHistory] = useState<TickerTxnRow[]>([]);
  const [txnSortKey, setTxnSortKey] = useState<TxnSortKey>('date');
  const [txnSortDir, setTxnSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    (async () => {
      const found = await store.getStockHistory(ticker);
      try {
        const funds = await fetchFundCache();
        setFundEntry(getFundPrice(funds, ticker));
        const valued = found ? applyPricesToAggregated([found], fundCacheToPriceLookup(funds))[0] : null;
        setStock(valued);
      } catch (e: any) {
        console.log('[FundDetail] fund cache unavailable:', e.message);
        setStock(found);
      }

      if (found) {
        try {
          const perBucket = await Promise.all(
            found.buckets.map(async (b) => {
              const rows = await store.getTransactionHistory(b.bucket, ticker);
              return rows.map((r) => ({ ...r, bucket: b.bucket }));
            })
          );
          setTxnHistory(perBucket.flat());
        } catch (e: any) {
          console.log('[FundDetail] transaction history unavailable:', e.message);
          setTxnHistory([]);
        }
      } else {
        setTxnHistory([]);
      }

      setLoading(false);
    })();
  }, [store, ticker]);

  // Refresh watchlist status on every focus (not just mount) - same
  // rationale as StockDetailScreen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      store.getWatchlist().then((list) => {
        if (!cancelled) setWatchlistItem(list.find((w) => w.ticker === ticker) ?? null);
      });
      return () => { cancelled = true; };
    }, [store, ticker])
  );

  async function toggleWatchlist() {
    setWatchlistBusy(true);
    try {
      if (watchlistItem) {
        await store.removeFromWatchlist(ticker);
        setWatchlistItem(null);
      } else {
        await store.addToWatchlist(ticker);
        setWatchlistItem({ ticker, buyBelowPrice: null, addedAt: new Date().toISOString() });
      }
    } catch (e: any) {
      Alert.alert('Could not update Watch List', e.message ?? String(e));
    }
    setWatchlistBusy(false);
  }

  async function saveWatchlistBuyBelow(price: number | null) {
    try {
      await store.setWatchlistBuyBelowPrice(ticker, price);
      setWatchlistItem((prev) => (prev ? { ...prev, buyBelowPrice: price } : prev));
    } catch (e: any) {
      Alert.alert('Could not save price', e.message ?? String(e));
    }
  }

  const sortedTxnHistory = useMemo(() => {
    const rows = [...txnHistory];
    rows.sort((a, b) => {
      const cmp = txnSortKey === 'bucket' ? a.bucket.localeCompare(b.bucket)
        : txnSortKey === 'date' ? a.date.localeCompare(b.date)
        : a.price - b.price;
      return txnSortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [txnHistory, txnSortKey, txnSortDir]);

  function toggleTxnSort(key: TxnSortKey) {
    if (txnSortKey === key) {
      setTxnSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTxnSortKey(key);
      setTxnSortDir(key === 'date' ? 'desc' : 'asc');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Not held in any bucket - still show what's available (NAVPU from the
  // fund feed) rather than a dead end, same "no holdings, and that's fine"
  // handling as StockDetailScreen.
  if (!stock) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.ticker}>{ticker}</Text>
        <Text style={styles.subtitle}>Not currently held in any bucket</Text>

        <View style={styles.watchlistCard}>
          <WatchlistSection
            inWatchlist={!!watchlistItem}
            buyBelowPrice={watchlistItem?.buyBelowPrice ?? null}
            currentPrice={fundEntry?.navpu ?? null}
            busy={watchlistBusy}
            onToggle={toggleWatchlist}
            onSaveBuyBelow={saveWatchlistBuyBelow}
          />
        </View>

        <View style={styles.statsRow}>
          <Stat label="NAVPU" value={fundEntry ? `₱${fundEntry.navpu}` : 'N/A'} />
        </View>

        <FundDetailsSection ticker={ticker} />

        <Text style={styles.positionsHeader}>Held In</Text>
        <PositionsTable items={[]} onItemPress={() => {}} emptyText="Not currently held in any bucket." />
      </ScrollView>
    );
  }

  const valued = 'marketValue' in stock ? (stock as ValuedAggregatedStock) : null;
  const heldIn = stock.buckets.map((b) => toPositionItem(b, colors));
  const activeBucketCount = stock.buckets.filter((b) => b.totalQty > 0 || b.pendingSettlement).length;
  const closedBucketCount = stock.buckets.length - activeBucketCount;
  const totalRealizedGain = stock.buckets.reduce((s, b) => s + b.realizedGain, 0);
  const totalUnrealizedGain = valued ? valued.buckets.reduce((s, b) => s + (b.unrealizedGain ?? 0), 0) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.ticker}>{stock.ticker}</Text>
      <Text style={styles.subtitle}>
        {activeBucketCount > 0
          ? `Across ${activeBucketCount} bucket${activeBucketCount === 1 ? '' : 's'}${closedBucketCount > 0 ? ` · sold out of ${closedBucketCount} more` : ''}`
          : `Fully sold · previously held in ${stock.buckets.length} bucket${stock.buckets.length === 1 ? '' : 's'}`}
      </Text>

      <View style={styles.watchlistCard}>
        <WatchlistSection
          inWatchlist={!!watchlistItem}
          buyBelowPrice={watchlistItem?.buyBelowPrice ?? null}
          currentPrice={valued?.currentPrice ?? fundEntry?.navpu ?? null}
          busy={watchlistBusy}
          onToggle={toggleWatchlist}
          onSaveBuyBelow={saveWatchlistBuyBelow}
        />
      </View>
      <View style={styles.statsRow}>
        <Stat label="NAVPU" value={`₱${valued?.currentPrice ?? fundEntry?.navpu ?? 'N/A'}`} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Total Units" value={String(stock.totalQty)} />
        <Stat label="Blended Avg Cost" value={`₱${stock.avgCost}`} />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label={valued?.marketValue != null ? 'Market Value' : 'Total Cost Basis'}
          value={`₱${(valued?.marketValue ?? stock.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          big
        />
        <Stat label="Total Dividends" value={`₱${stock.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big sign="positive" />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label="Realized Gain"
          value={`${totalRealizedGain >= 0 ? '+' : ''}₱${totalRealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          sign={totalRealizedGain >= 0 ? 'positive' : 'negative'}
        />
        {totalUnrealizedGain != null && (
          <Stat
            label="Unrealized Gain"
            value={`${totalUnrealizedGain >= 0 ? '+' : ''}₱${totalUnrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sign={totalUnrealizedGain >= 0 ? 'positive' : 'negative'}
          />
        )}
      </View>

      <FundDetailsSection ticker={stock.ticker} />

      <Text style={styles.positionsHeader}>Held In</Text>
      <PositionsTable
        items={heldIn}
        onItemPress={(bucket) => navigation.navigate('StockInBucket', { bucket, ticker: stock.ticker })}
        emptyText="Not currently held in any bucket."
      />

      <Text style={styles.positionsHeader}>All Transactions</Text>
      <TickerTransactionsTable
        rows={sortedTxnHistory}
        sortKey={txnSortKey}
        sortDir={txnSortDir}
        onSort={toggleTxnSort}
      />
    </ScrollView>
  );
}

function TickerTransactionsTable({
  rows, sortKey, sortDir, onSort,
}: {
  rows: TickerTxnRow[];
  sortKey: TxnSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: TxnSortKey) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (rows.length === 0) {
    return <Text style={styles.empty}>No transactions for this ticker.</Text>;
  }

  const arrow = sortDir === 'asc' ? '↑' : '↓';
  function HeaderCell({ label, col, style }: { label: string; col: TxnSortKey; style: StyleProp<ViewStyle> }) {
    return (
      <Pressable style={style} onPress={() => onSort(col)} hitSlop={6}>
        <Text style={[styles.txnTableHeaderText, sortKey === col && styles.txnTableHeaderTextActive]}>
          {label}{sortKey === col ? ` ${arrow}` : ''}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.txnTable}>
      <View style={styles.txnTableRow}>
        <HeaderCell label="Bucket" col="bucket" style={styles.txnTableColBucket} />
        <HeaderCell label="Date" col="date" style={styles.txnTableColDate} />
        <Text style={[styles.txnTableHeaderText, styles.txnTableColShares]}>Units</Text>
        <HeaderCell label="Price" col="price" style={styles.txnTableColPrice} />
      </View>
      {rows.map((r, i) => (
        <View key={i} style={[styles.txnTableRow, styles.txnTableDataRow]}>
          <Text style={[styles.txnTableCellText, styles.txnTableColBucket]} numberOfLines={1}>{r.bucket}</Text>
          <Text style={[styles.txnTableCellText, styles.txnTableColDate]}>{r.date}</Text>
          <Text style={[styles.txnTableCellText, styles.txnTableColShares, r.type === 'SELL' && styles.negative]}>
            {r.type === 'SELL' ? '−' : ''}{r.quantity.toLocaleString()}
          </Text>
          <Text style={[styles.txnTableCellText, styles.txnTableColPrice]}>₱{r.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
        </View>
      ))}
    </View>
  );
}

function Stat({ label, value, big, sign, sublabel }: { label: string; value: string; big?: boolean; sign?: 'positive' | 'negative'; sublabel?: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statValueBig, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  ticker: { fontFamily: fonts.monoBold, fontSize: 26, color: colors.onBackground },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.xl, padding: spacing.md },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 16, color: colors.onSurface },
  statValueBig: { fontSize: 20 },
  statSublabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  watchlistCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.xs, marginBottom: spacing.md },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
  txnTable: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, overflow: 'hidden', marginBottom: spacing.lg,
  },
  txnTableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.md },
  txnTableDataRow: { borderTopWidth: 1, borderTopColor: colors.outlineVariant },
  txnTableColBucket: { flex: 1.3, paddingRight: spacing.xs },
  txnTableColDate: { flex: 1.1 },
  txnTableColShares: { flex: 0.9, textAlign: 'right' },
  txnTableColPrice: { flex: 0.9, textAlign: 'right' },
  txnTableHeaderText: {
    fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  txnTableHeaderTextActive: { color: colors.onSurface },
  txnTableCellText: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
});
