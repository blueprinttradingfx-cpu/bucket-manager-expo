// screens/SearchStockScreen.tsx
// "Search stock": browse the FULL PSE ticker universe (via
// core/stockUniverse.ts, sourced from the price-scraper's tickers.json),
// not just what you currently hold. For a ticker you already hold, tapping
// it goes straight to the existing StockDetailScreen. For one you don't,
// this screen answers the question that was missing from day one:
// "AREIT - 6.5% div yield - buy on what bucket?" - matching the ticker's
// current yield against your configured bucket brackets.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../core/StoreProvider';
import { fetchStockUniverse } from '../core/stockUniverse';
import { fetchPriceCache, PriceCache } from '../core/priceCache';
import { YieldBracket } from '../core/bucketLogic';
import { DashboardStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts } from '../core/theme';
import BucketSuggestion from './components/BucketSuggestion';

type Props = NativeStackScreenProps<DashboardStackParamList, 'SearchStock'>;

export default function SearchStockScreen({ navigation }: Props) {
  useScreenViewLog('SearchStock');
  const store = useStore();
  const [query, setQuery] = useState('');
  const [universe, setUniverse] = useState<string[]>([]);
  const [heldTickers, setHeldTickers] = useState<Set<string>>(new Set());
  const [priceCache, setPriceCache] = useState<PriceCache | null>(null);
  const [buckets, setBuckets] = useState<YieldBracket[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tickers, held, prices, bucketRows] = await Promise.all([
        fetchStockUniverse(),
        store.getAggregatedStocks(),
        fetchPriceCache().catch(() => null),
        store.listBuckets(),
      ]);
      setUniverse(tickers);
      setHeldTickers(new Set(held.map((h) => h.ticker)));
      setPriceCache(prices);
      setBuckets(bucketRows);
    } catch (e: any) {
      console.log('[SearchStock] failed to load:', e.message);
      setError(e.message);
    }
    setLoading(false);
  }, [store]);

  useEffect(() => { load(); }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return universe.slice(0, 30); // don't dump all ~300+ tickers before the person's typed anything
    return universe.filter((t) => t.includes(q)).slice(0, 50);
  }, [universe, query]);

  function toggleExpanded(ticker: string) {
    setExpanded((prev) => (prev === ticker ? null : ticker));
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search ticker (e.g. AREIT)"
        placeholderTextColor={colors.onSurfaceVariant}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!loading && error && (
        <Text style={styles.errorText}>Couldn't load the stock list: {error}</Text>
      )}

      {!loading && !error && (
        <FlatList
          data={results}
          keyExtractor={(t) => t}
          ListEmptyComponent={<Text style={styles.empty}>No tickers match "{query}".</Text>}
          renderItem={({ item: ticker }) => {
            const isHeld = heldTickers.has(ticker);
            const priceEntry = priceCache?.tickers[ticker];
            const isOpen = expanded === ticker;

            return (
              <View style={styles.card}>
                <Pressable
                  style={styles.row}
                  onPress={() => isHeld ? navigation.navigate('StockDetail', { ticker }) : toggleExpanded(ticker)}
                >
                  <Text style={styles.ticker}>{ticker}</Text>
                  <View style={styles.rowRight}>
                    {priceEntry ? (
                      <Text style={styles.price}>₱{priceEntry.price}</Text>
                    ) : (
                      <Text style={styles.priceUnavailable}>no price yet</Text>
                    )}
                    {isHeld ? (
                      <View style={styles.heldBadge}><Text style={styles.heldBadgeText}>Held</Text></View>
                    ) : (
                      <Text style={styles.chevron}>{isOpen ? '⌄' : '›'}</Text>
                    )}
                  </View>
                </Pressable>

                {isOpen && !isHeld && (
                  <View style={styles.expandedPanel}>
                    <BucketSuggestion ticker={ticker} yieldPct={priceEntry?.yieldPct ?? null} buckets={buckets} />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  center: { paddingVertical: 40, alignItems: 'center' },
  searchInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.md, fontFamily: fonts.monoSemiBold, fontSize: 15,
  },
  errorText: { fontFamily: fonts.bodyMedium, color: colors.negative, textAlign: 'center', marginTop: 24 },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, marginBottom: spacing.base, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  ticker: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  price: { fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface },
  priceUnavailable: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  heldBadge: { backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  heldBadgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.primary },
  chevron: { color: colors.onSurfaceVariant, fontSize: 18 },
  expandedPanel: {
    backgroundColor: colors.surfaceVariant, borderTopWidth: 1, borderTopColor: colors.outlineVariant,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
});
