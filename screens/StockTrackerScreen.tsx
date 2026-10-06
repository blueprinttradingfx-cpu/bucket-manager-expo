// screens/StockTrackerScreen.tsx
// Main Stock Tracker screen: lists all tracked stocks with key metrics, MACD trend,
// foreign flow sentiment, area of interest, catalyst, projection, and linked alerts.
// Features search/filtering, live price resolution, pull-to-refresh, and add/edit flow.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, RefreshControl,
  TextInput, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../core/StoreProvider';
import { useThemeColors } from '../core/ThemeContext';
import { spacing, radii, fonts, ThemeColors } from '../core/theme';
import { TrackerStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { fetchPriceCache } from '../core/priceCache';
import { fetchFundCache } from '../core/fundCache';
import { StockTrackerEntry, StockAlert } from '../core/storeApi';
import StockTrackerTable, { DisplayTrackerEntry } from './components/StockTrackerTable';
import StockTrackerEditorDialog from './components/StockTrackerEditorDialog';

type Props = NativeStackScreenProps<TrackerStackParamList, 'StockTrackerHome'>;

type FilterCategory = 'all' | 'bullish' | 'bearish' | 'sideways' | 'buying' | 'selling';

const FILTER_CHIPS: { key: FilterCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bullish', label: 'Bullish MACD' },
  { key: 'bearish', label: 'Bearish MACD' },
  { key: 'sideways', label: 'Sideways' },
  { key: 'buying', label: 'Foreign Buying' },
  { key: 'selling', label: 'Foreign Selling' },
];

export default function StockTrackerScreen({ navigation }: Props) {
  useScreenViewLog('StockTracker');
  const colors = useThemeColors();
  const store = useStore();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<StockTrackerEntry[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [staleWarning, setStaleWarning] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');

  // Dialog state for T-06c (Add / Edit modal)
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<StockTrackerEntry | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [trackerEntries, alertList, priceFeed, fundFeed] = await Promise.all([
        store.listAllStockTrackerEntries(),
        store.listAllStockAlerts(),
        fetchPriceCache().catch(() => null),
        fetchFundCache().catch(() => null),
      ]);

      setEntries(trackerEntries);
      setAlerts(alertList);

      const priceMap: Record<string, number> = {};
      if (priceFeed?.tickers) {
        for (const [t, p] of Object.entries(priceFeed.tickers)) {
          if (p.price != null) priceMap[t.toUpperCase()] = p.price;
        }
      }
      if (fundFeed?.funds) {
        for (const [t, f] of Object.entries(fundFeed.funds)) {
          if (f.navpu != null) priceMap[t.toUpperCase()] = f.navpu;
        }
      }
      setPrices(priceMap);
    } catch (e) {
      console.error('[StockTrackerScreen] Failed to load data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [store]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Combine tracker entries with live prices & linked alert objects
  const displayEntries: DisplayTrackerEntry[] = useMemo(() => {
    const alertMap = new Map<string, StockAlert>();
    for (const a of alerts) {
      alertMap.set(a.id, a);
    }

    return entries.map((entry) => {
      const upper = entry.ticker.toUpperCase();
      const currentPrice = prices[upper] ?? null;
      const linkedAlert = entry.priceAlertId ? alertMap.get(entry.priceAlertId) : null;
      return {
        ...entry,
        currentPrice,
        linkedAlert,
      };
    });
  }, [entries, alerts, prices]);

  // Filter & Search logic
  const filteredEntries = useMemo(() => {
    return displayEntries.filter((item) => {
      // Category filter
      if (activeFilter === 'bullish') {
        if (!item.weeklyMacdTrend.startsWith('bullish')) return false;
      } else if (activeFilter === 'bearish') {
        if (!item.weeklyMacdTrend.startsWith('bearish')) return false;
      } else if (activeFilter === 'sideways') {
        if (item.weeklyMacdTrend !== 'sideways') return false;
      } else if (activeFilter === 'buying') {
        if (!item.foreignFlowSentiment.includes('buying')) return false;
      } else if (activeFilter === 'selling') {
        if (!item.foreignFlowSentiment.includes('selling')) return false;
      }

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTicker = item.ticker.toLowerCase().includes(q);
        const matchCatalyst = item.eventCatalyst.toLowerCase().includes(q);
        const matchProjection = item.projection.toLowerCase().includes(q);
        const matchArea = item.areaPriceOfInterest.toLowerCase().includes(q);
        const matchNotes = (item.notes ?? '').toLowerCase().includes(q);
        if (!matchTicker && !matchCatalyst && !matchProjection && !matchArea && !matchNotes) {
          return false;
        }
      }

      return true;
    });
  }, [displayEntries, activeFilter, searchQuery]);

  const handleCreate = () => {
    setEditingEntry(null);
    setDialogVisible(true);
  };

  const handleEdit = (entry: DisplayTrackerEntry) => {
    setEditingEntry(entry);
    setDialogVisible(true);
  };

  const handleDelete = (id: string) => {
    const target = entries.find((e) => e.id === id);
    const tickerName = target?.ticker ?? 'this entry';

    Alert.alert(
      'Remove Tracked Stock',
      `Are you sure you want to stop tracking ${tickerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await store.deleteStockTrackerEntry(id);
              loadData();
            } catch (e) {
              console.error('[StockTrackerScreen] Delete failed:', e);
              Alert.alert('Error', 'Failed to remove tracked stock.');
            }
          },
        },
      ]
    );
  };

  const handleNavigateToStock = (ticker: string) => {
    navigation.navigate('StockDetail', { ticker });
  };

  // T-07: tapping an alert chip in the table navigates to StockDetail
  // so the user can see the Alerts section (which shows the linked alert).
  const handleAlertPress = (ticker: string) => {
    navigation.navigate('StockDetail', { ticker });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Title & FAB Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Stock Tracker</Text>
            <Text style={styles.subtitle}>
              {entries.length} stock{entries.length === 1 ? '' : 's'} tracked across technicals & sentiment
            </Text>
          </View>
          <Pressable style={styles.addBtn} onPress={handleCreate}>
            <Ionicons name="add" size={20} color={colors.onPrimary} style={{ marginRight: 4 }} />
            <Text style={styles.addBtnText}>Add Stock</Text>
          </Pressable>
        </View>

        {staleWarning && (
          <View style={styles.staleBanner}>
            <Ionicons name="warning-outline" size={16} color={colors.negative} style={{ marginRight: 6 }} />
            <Text style={styles.staleBannerText}>Price feed is outdated. Pull down to refresh.</Text>
          </View>
        )}

        {/* Search & Filter Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.onSurfaceVariant} style={{ marginRight: spacing.xs }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search ticker, catalyst, area..."
              placeholderTextColor={colors.onSurfaceVariant}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>

          {/* Filter Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {FILTER_CHIPS.map((chip) => {
              const active = activeFilter === chip.key;
              return (
                <Pressable
                  key={chip.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setActiveFilter(chip.key)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Loading Indicator */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          /* Table View */
          <StockTrackerTable
            entries={filteredEntries}
            onSelectEntry={handleEdit}
            onDeleteEntry={handleDelete}
            onNavigateToStock={handleNavigateToStock}
            onAlertPress={handleAlertPress}
            emptyText={
              searchQuery || activeFilter !== 'all'
                ? 'No tracked stocks match your filters.'
                : 'No tracked stocks yet. Tap "+ Add Stock" to start!'
            }
          />
        )}
      </ScrollView>

      {/* T-06c Add/Edit Dialog Modal */}
      {dialogVisible && (
        <StockTrackerEditorDialog
          visible={dialogVisible}
          initialEntry={editingEntry}
          onClose={() => setDialogVisible(false)}
          onSaveSuccess={() => {
            setDialogVisible(false);
            loadData();
          }}
        />
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: fonts.bodyBold,
      fontSize: 24,
      color: colors.onBackground,
    },
    subtitle: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
    },
    addBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onPrimary,
    },
    staleBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.negative + '15',
      borderColor: colors.negative + '40',
      borderWidth: 1,
      padding: spacing.sm,
      borderRadius: radii.lg,
      marginBottom: spacing.md,
    },
    staleBannerText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.negative,
    },
    searchContainer: {
      marginBottom: spacing.md,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.sm,
      height: 40,
      marginBottom: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.onSurface,
      padding: 0,
    },
    chipScroll: {
      flexDirection: 'row',
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainerHigh,
      marginRight: spacing.xs,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    chipTextActive: {
      color: colors.onPrimary,
    },
    loadingBox: {
      paddingVertical: spacing.xxl,
      alignItems: 'center',
    },
  });
}
