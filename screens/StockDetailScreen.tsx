// screens/StockDetailScreen.tsx
// Level 3 of the drill-down: one ticker, merged across every bucket that
// holds it. Restyled to match the Stitch design system (see
// DashboardScreen for the full rationale). Includes live valuation
// (market value, unrealized gain, current yield) when the price cache is
// reachable - degrades gracefully to cost-basis-only otherwise. The
// "Held In" list uses the same Positions table component as the other two
// screens, just with rows keyed by bucket instead of ticker.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Alert from '../core/alert';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, ValuedAggregatedStock, ValuedStockPosition, BucketStockPosition, applyPricesToAggregated, computePortfolioValuation, YieldBracket } from '../core/bucketLogic';
import { WatchlistItem } from '../core/storeApi';
import { fetchPriceCache, PriceEntry } from '../core/priceCache';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import BucketSuggestion from './components/BucketSuggestion';
import WatchlistSection from './components/WatchlistSection';

// Minimal structural prop type, not tied to either stack's specific
// NativeStackScreenProps - this screen is registered in BOTH DashboardStack
// (via SearchStock) and BucketsStack (via BucketDetail's "Find stocks"
// finder), reachable through two different drill-down paths. The only
// navigation call it makes is 'StockInBucket', which both stacks declare
// identically, so a narrow structural type covers both without needing a
// union of the two full param lists.
interface Props {
  route: { params: { ticker: string } };
  navigation: { navigate: (screen: 'StockInBucket', params: { bucket: string; ticker: string }) => void };
}

type BucketPositionRow = ValuedStockPosition | BucketStockPosition;

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

export default function StockDetailScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
  useScreenViewLog('StockDetail', { ticker });
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const [stock, setStock] = useState<AggregatedStock | ValuedAggregatedStock | null>(null);
  const [buckets, setBuckets] = useState<YieldBracket[]>([]);
  const [priceEntry, setPriceEntry] = useState<PriceEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlistItem, setWatchlistItem] = useState<WatchlistItem | null>(null);
  const [watchlistBusy, setWatchlistBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [found, bucketRows] = await Promise.all([store.getStockHistory(ticker), store.listBuckets()]);
      setBuckets(bucketRows);
      try {
        const prices = await fetchPriceCache();
        setPriceEntry(prices.tickers[ticker] ?? null);
        const valued = found ? applyPricesToAggregated([found], prices.tickers)[0] : null;
        setStock(valued);
      } catch (e: any) {
        console.log('[StockDetail] price cache unavailable:', e.message);
        setStock(found);
      }
      setLoading(false);
    })();
  }, [store, ticker]);

  // Refresh watchlist status on every focus (not just mount) - so removing
  // this ticker from the Watch List tab and coming back here reflects it
  // immediately, same as buckets refresh in BucketsScreen.
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Not held in any bucket - still show what's available (price/yield from
  // the cache, bucket-fit suggestion) rather than a dead end. This used to
  // bail out entirely here because SearchStockScreen only navigated here for
  // tickers you already held - now it navigates for any ticker, so this
  // screen needs to handle "no holdings, and that's fine" as its own state.
  if (!stock) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.ticker}>{ticker}</Text>
        <Text style={styles.subtitle}>Not currently held in any bucket</Text>

        <View style={styles.suggestionCard}>
          <BucketSuggestion ticker={ticker} yieldPct={priceEntry?.yieldPct ?? null} buckets={buckets} />
        </View>

        <View style={styles.watchlistCard}>
          <WatchlistSection
            inWatchlist={!!watchlistItem}
            buyBelowPrice={watchlistItem?.buyBelowPrice ?? null}
            currentPrice={priceEntry?.price ?? null}
            busy={watchlistBusy}
            onToggle={toggleWatchlist}
            onSaveBuyBelow={saveWatchlistBuyBelow}
          />
        </View>

        <View style={styles.statsRow}>
          <Stat
            label="Current Price"
            value={priceEntry ? `₱${priceEntry.price}` : 'N/A'}
            sublabel={priceEntry?.yieldPct != null ? `yield ${priceEntry.yieldPct}%` : 'no yield data'}
          />
        </View>

        <Text style={styles.positionsHeader}>Held In</Text>
        <PositionsTable items={[]} onItemPress={() => {}} emptyText="Not currently held in any bucket." />
      </ScrollView>
    );
  }

  const valued = 'marketValue' in stock ? (stock as ValuedAggregatedStock) : null;
  const heldIn = stock.buckets.map((b) => toPositionItem(b, colors));
  const valuation = valued
    ? computePortfolioValuation(stock.buckets as ValuedStockPosition[], stock.totalDividends, stock.totalCostBasis)
    : null;
  const activeBucketCount = stock.buckets.filter((b) => b.totalQty > 0 || b.pendingSettlement).length;
  const closedBucketCount = stock.buckets.length - activeBucketCount;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.ticker}>{stock.ticker}</Text>
      <Text style={styles.subtitle}>
        {activeBucketCount > 0
          ? `Across ${activeBucketCount} bucket${activeBucketCount === 1 ? '' : 's'}${closedBucketCount > 0 ? ` · sold out of ${closedBucketCount} more` : ''}`
          : `Fully sold · previously held in ${stock.buckets.length} bucket${stock.buckets.length === 1 ? '' : 's'}`}
      </Text>

      <View style={styles.suggestionCard}>
        <BucketSuggestion ticker={stock.ticker} yieldPct={valued?.currentYieldPct ?? null} buckets={buckets} />
      </View>
      <View style={styles.watchlistCard}>
        <WatchlistSection
          inWatchlist={!!watchlistItem}
          buyBelowPrice={watchlistItem?.buyBelowPrice ?? null}
          currentPrice={valued?.currentPrice ?? null}
          busy={watchlistBusy}
          onToggle={toggleWatchlist}
          onSaveBuyBelow={saveWatchlistBuyBelow}
        />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label="Current Price"
          value={`₱${valued?.currentPrice ?? 'N/A'}`}
          sublabel={valued?.currentYieldPct != null ? `yield ${valued.currentYieldPct}%` : undefined}
        />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Total Shares" value={String(stock.totalQty)} />
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
      {valuation && (
        <View style={styles.statsRow}>
          <Stat
            label="Unrealized Gain"
            value={`${valuation.totalUnrealizedGain >= 0 ? '+' : ''}₱${valuation.totalUnrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valuation.totalUnrealizedGainPct >= 0 ? '+' : ''}${valuation.totalUnrealizedGainPct}%`}
            sign={valuation.totalUnrealizedGain >= 0 ? 'positive' : 'negative'}
          />
          <Stat
            label="Total Return"
            value={`${valuation.totalReturn >= 0 ? '+' : ''}₱${valuation.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valuation.totalReturnPct >= 0 ? '+' : ''}${valuation.totalReturnPct}% (div + gain)`}
            sign={valuation.totalReturn >= 0 ? 'positive' : 'negative'}
          />
        </View>
      )}

      <Text style={styles.positionsHeader}>Held In</Text>
      <PositionsTable
        items={heldIn}
        onItemPress={(bucket) => navigation.navigate('StockInBucket', { bucket, ticker: stock.ticker })}
        emptyText="Not currently held in any bucket."
      />
    </ScrollView>
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
  priceLine: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  suggestionCard: {
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  watchlistCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.xs, marginBottom: spacing.md },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
});
