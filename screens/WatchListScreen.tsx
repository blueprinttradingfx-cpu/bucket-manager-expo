// screens/WatchListScreen.tsx
// Level 1 of the Watch List tab: every ticker the user has curated (via
// "Add to Watch List" on StockDetailScreen, reached from the search icon
// in the header - see App.tsx's WatchListStack). Two tabs, same concept as
// the reference "Snowball Picks" screens the user shared: "Within Buy
// Range" (tickers with a buy-below price set AND a current price at or
// under it) and the full list. Reuses PositionsTable's tabTrack/tabButton
// visual pattern (see DashboardScreen/BucketDetailScreen) rather than the
// reference's underline style, so the Watch List tab doesn't introduce a
// second tab styling into the app.
//
// Price/yield data comes from the same fetchPriceCache() used everywhere
// else (SearchStockScreen, StockDetailScreen) - degrades to "N/A"/no-yield
// per row rather than failing the whole screen if the cache is
// unreachable, same pattern as those screens.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Alert from '../core/alert';
import { useStore } from '../core/StoreProvider';
import { WatchlistItem } from '../core/storeApi';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { YieldBracket } from '../core/bucketLogic';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import WatchlistTable, { WatchlistRowItem } from './components/WatchlistTable';
import ImportPortfolioModal from './components/ImportPortfolioModal';
import { Portfolio } from '../core/portfolioCatalog';
import { dedupePortfolioStocks } from '../core/watchlistImport';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  navigation: { navigate: (screen: 'StockDetail' | 'SearchStock', params?: { ticker: string }) => void };
}

type TabKey = 'within_range' | 'all';

export default function WatchListScreen({ navigation }: Props) {
  useScreenViewLog('WatchList');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [buckets, setBuckets] = useState<YieldBracket[]>([]);
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('within_range');
  const [showImportModal, setShowImportModal] = useState(false);

  const load = useCallback(async (forcePrices = false) => {
    const [watchlist, bucketRows] = await Promise.all([store.getWatchlist(), store.listBuckets()]);
    setItems(watchlist);
    setBuckets(bucketRows);
    try {
      const prices = await fetchPriceCache(undefined, { force: forcePrices });
      setPriceCache(prices);
      setPriceError(null);
    } catch (e: any) {
      console.log('[WatchList] price cache unavailable:', e.message);
      setPriceCache(null);
      setPriceError(e.message);
    }
  }, [store]);

  // Refresh on every focus, not just mount - adding/removing a ticker from
  // StockDetailScreen and coming back here should reflect it immediately,
  // same rationale as StockDetailScreen's own watchlist-status refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => { cancelled = true; };
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  const rows: WatchlistRowItem[] = useMemo(() => items.map((item) => {
    const priceEntry = priceCache?.tickers[item.ticker] ?? null;
    const currentPrice = priceEntry?.price ?? null;
    const withinRange = item.buyBelowPrice != null && currentPrice != null && currentPrice <= item.buyBelowPrice;
    return {
      ticker: item.ticker,
      currentPrice,
      yieldPct: priceEntry?.yieldPct ?? null,
      buyBelowPrice: item.buyBelowPrice,
      withinRange,
    };
  }), [items, priceCache]);

  const withinRangeRows = useMemo(() => rows.filter((r) => r.withinRange), [rows]);
  const visible = activeTab === 'within_range' ? withinRangeRows : rows;

  async function handleSaveBuyBelow(ticker: string, price: number | null) {
    try {
      await store.setWatchlistBuyBelowPrice(ticker, price);
      setItems((prev) => prev.map((it) => (it.ticker === ticker ? { ...it, buyBelowPrice: price } : it)));
    } catch (e: any) {
      Alert.alert('Could not save price', e.message ?? String(e));
    }
  }

  function handleRemove(ticker: string) {
    Alert.alert('Remove from Watch List', `Stop watching ${ticker}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await store.removeFromWatchlist(ticker);
            setItems((prev) => prev.filter((it) => it.ticker !== ticker));
          } catch (e: any) {
            Alert.alert('Could not remove', e.message ?? String(e));
          }
        },
      },
    ]);
  }

  // Combine every selected portfolio's tickers first (so AREIT showing up
  // in two selected portfolios is resolved to one row - lower price wins -
  // before it ever reaches the store), then hand the merged list to
  // importPortfolioIntoWatchlist, which applies the same lower-price rule
  // against whatever's already on the watchlist.
  async function handleImportPortfolios(portfolios: Portfolio[]) {
    const combined = dedupePortfolioStocks(portfolios.flatMap((p) => p.stocks));
    try {
      const result = await store.importPortfolioIntoWatchlist(combined);
      setShowImportModal(false);
      await load();
      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.loweredPrice > 0) parts.push(`${result.loweredPrice} buy-below price${result.loweredPrice === 1 ? '' : 's'} lowered`);
      if (result.unchanged > 0) parts.push(`${result.unchanged} already up to date`);
      Alert.alert('Portfolio imported', parts.length > 0 ? parts.join(' · ') : 'Nothing new to import.');
    } catch (e: any) {
      Alert.alert('Could not import', e.message ?? String(e));
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.subtitle}>
        {items.length === 0
          ? 'Curate tickers to keep an eye on - tap the search icon above to add one.'
          : `Watching ${items.length} ticker${items.length === 1 ? '' : 's'}${withinRangeRows.length > 0 ? ` · ${withinRangeRows.length} within buy range` : ''}`}
      </Text>
      {priceError && (
        <Text style={styles.priceWarning}>Live prices unavailable right now - buy-range and yield may be out of date.</Text>
      )}

      <Pressable style={styles.importPortfolioButton} onPress={() => setShowImportModal(true)}>
        <Ionicons name="download-outline" size={16} color={colors.primary} />
        <Text style={styles.importPortfolioButtonText}>Import Portfolio</Text>
      </Pressable>

      {items.length > 0 && (
        <View style={styles.tabTrack}>
          <TabButton
            label="Within Buy Range"
            count={withinRangeRows.length}
            active={activeTab === 'within_range'}
            onPress={() => setActiveTab('within_range')}
          />
          <TabButton
            label="Full Watch List"
            count={rows.length}
            active={activeTab === 'all'}
            onPress={() => setActiveTab('all')}
          />
        </View>
      )}

      <WatchlistTable
        items={visible}
        buckets={buckets}
        onItemPress={(ticker) => navigation.navigate('StockDetail', { ticker })}
        onSaveBuyBelow={handleSaveBuyBelow}
        onRemove={handleRemove}
        emptyText={
          items.length === 0
            ? 'Nothing on your Watch List yet.'
            : activeTab === 'within_range'
              ? 'Nothing within buy range right now. Set a buy-below price on a ticker to see it here once its price drops to that level.'
              : 'Nothing here yet.'
        }
      />

      <ImportPortfolioModal
        visible={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportPortfolios}
      />
    </ScrollView>
  );
}

function TabButton({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>
        {label} <Text style={styles.tabButtonCount}>{count}</Text>
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  priceWarning: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative, marginBottom: spacing.sm },
  importPortfolioButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  importPortfolioButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.primary },
  tabTrack: {
    flexDirection: 'row', backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.lg,
    padding: 2, marginBottom: spacing.md, alignSelf: 'flex-start',
  },
  tabButton: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.lg - 1 },
  tabButtonActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabButtonText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  tabButtonTextActive: { fontFamily: fonts.bodyBold, color: colors.primary },
  tabButtonCount: { opacity: 0.5 },
});
