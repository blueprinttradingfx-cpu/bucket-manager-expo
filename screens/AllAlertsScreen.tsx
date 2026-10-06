// screens/AllAlertsScreen.tsx
// Global Stock Alerts Management Screen: flat list of all stock alerts across
// all tickers with quick filters (Status, Type, Ticker search), inline pause/resume
// toggle switch, delete action, and trigger history details (lastCheckedAt / lastTriggeredAt).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Alert from '../core/alert';
import { spacing, radii, fonts, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { SettingsStackParamList } from '../core/navigationTypes';
import { useStore } from '../core/StoreProvider';
import { StockAlert } from '../core/storeApi';
import { useScreenViewLog } from '../core/useScreenViewLog';

type Props = NativeStackScreenProps<SettingsStackParamList, 'AllAlerts'>;

type StatusFilter = 'all' | 'active' | 'paused';
type TypeFilter = 'all' | 'event' | 'price';

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

export default function AllAlertsScreen({ route }: Props) {
  useScreenViewLog('AllAlerts');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const navigation = useNavigation<any>();

  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState(route.params?.tickerFilter ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const loadAlerts = useCallback(async () => {
    try {
      const list = await store.listAllStockAlerts();
      setAlerts(list);
    } catch (e) {
      console.error('[AllAlertsScreen] load failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [store]);

  useFocusEffect(
    useCallback(() => {
      loadAlerts();
    }, [loadAlerts])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadAlerts();
  };

  const handleToggleStatus = async (alertItem: StockAlert) => {
    const nextStatus: StockAlert['status'] = alertItem.status === 'active' ? 'paused' : 'active';
    // Optimistic update locally
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertItem.id ? { ...a, status: nextStatus } : a))
    );
    try {
      await store.updateStockAlert(alertItem.id, { status: nextStatus });
    } catch (e) {
      console.error('[AllAlertsScreen] updateStockAlert status failed:', e);
      Alert.alert('Error', 'Failed to update alert status.');
      loadAlerts(); // Rollback
    }
  };

  const handleDeleteAlert = (alertItem: StockAlert) => {
    Alert.alert(
      'Delete Alert',
      `Are you sure you want to delete this alert for ${alertItem.ticker}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlerts((prev) => prev.filter((a) => a.id !== alertItem.id));
            try {
              await store.deleteStockAlert(alertItem.id);
            } catch (e) {
              console.error('[AllAlertsScreen] deleteStockAlert failed:', e);
              Alert.alert('Error', 'Failed to delete alert.');
              loadAlerts();
            }
          },
        },
      ]
    );
  };

  const handleNavigateTicker = (ticker: string) => {
    try {
      navigation.navigate('StockDetail', { ticker });
    } catch {
      try {
        navigation.navigate('Dashboard', { screen: 'StockDetail', params: { ticker } });
      } catch (e) {
        console.error('[AllAlertsScreen] navigate to StockDetail failed:', e);
      }
    }
  };

  const filteredAlerts = useMemo(() => {
    return alerts.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTicker = item.ticker.toLowerCase().includes(q);
        const matchesTitle = item.title.toLowerCase().includes(q);
        if (!matchesTicker && !matchesTitle) return false;
      }
      return true;
    });
  }, [alerts, statusFilter, typeFilter, searchQuery]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      {/* Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.onSurfaceVariant} style={{ marginRight: spacing.xs }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Filter by ticker or title..."
          placeholderTextColor={colors.onSurfaceVariant}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterSection}>
        {/* Status Chips */}
        <View style={styles.chipRow}>
          <Text style={styles.filterLabel}>Status:</Text>
          {(['all', 'active', 'paused'] as StatusFilter[]).map((st) => {
            const active = statusFilter === st;
            return (
              <Pressable
                key={st}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setStatusFilter(st)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Type Chips */}
        <View style={styles.chipRow}>
          <Text style={styles.filterLabel}>Type:</Text>
          {(['all', 'event', 'price'] as TypeFilter[]).map((tp) => {
            const active = typeFilter === tp;
            return (
              <Pressable
                key={tp}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setTypeFilter(tp)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {tp.charAt(0).toUpperCase() + tp.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Counter */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          Showing {filteredAlerts.length} of {alerts.length} alert{alerts.length === 1 ? '' : 's'}
        </Text>
      </View>

      {/* List / Empty State */}
      {filteredAlerts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.onSurfaceVariant} />
          <Text style={styles.emptyTitle}>
            {alerts.length === 0 ? 'No stock alerts created yet' : 'No alerts match your filter'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {alerts.length === 0
              ? 'Open any stock from your portfolio or search, scroll to Alerts, and tap "+ Add Alert" to create your first notification.'
              : 'Try clearing your search query or changing status and type filters.'}
          </Text>
        </View>
      ) : (
        filteredAlerts.map((item) => {
          const isEvent = item.type === 'event';
          const isPaused = item.status === 'paused';

          return (
            <Pressable
              key={item.id}
              style={[styles.alertCard, isPaused && styles.alertCardPaused]}
              onPress={() => handleNavigateTicker(item.ticker)}
            >
              {/* Card Header Row */}
              <View style={styles.cardHeader}>
                <View style={styles.badgeGroup}>
                  <View style={styles.tickerBadge}>
                    <Text style={styles.tickerBadgeText}>{item.ticker}</Text>
                  </View>
                  <View style={[styles.typeBadge, isEvent ? styles.typeBadgeEvent : styles.typeBadgePrice]}>
                    <Ionicons
                      name={
                        isEvent
                          ? 'calendar-outline'
                          : item.priceDirection === 'below'
                          ? 'trending-down-outline'
                          : 'trending-up-outline'
                      }
                      size={14}
                      color={isEvent ? colors.primary : colors.secondary}
                    />
                    <Text style={styles.typeBadgeText}>{isEvent ? 'Event' : 'Price'}</Text>
                  </View>
                </View>

                {/* Inline Pause/Resume Switch */}
                <View style={styles.headerRightActions}>
                  <View style={styles.switchWrap}>
                    <Text style={[styles.switchLabel, isPaused && styles.switchLabelPaused]}>
                      {isPaused ? 'Paused' : 'Active'}
                    </Text>
                    <Switch
                      value={!isPaused}
                      onValueChange={() => handleToggleStatus(item)}
                      trackColor={{ false: colors.surfaceVariant, true: colors.primary + '80' }}
                      thumbColor={!isPaused ? colors.primary : colors.onSurfaceVariant}
                    />
                  </View>
                </View>
              </View>

              {/* Title / Trigger condition */}
              <Text style={styles.alertTitle}>
                {isEvent
                  ? item.title || 'Event Reminder'
                  : `Price ${item.priceDirection === 'below' ? 'below' : 'above'} ₱${
                      item.priceThreshold != null ? item.priceThreshold.toFixed(2) : '0.00'
                    }`}
              </Text>

              {/* Details Subtitle */}
              <View style={styles.detailRow}>
                {isEvent ? (
                  <Text style={styles.detailText}>
                    Date: {item.eventDate ?? 'N/A'} {item.eventTime ? `at ${item.eventTime}` : ''} ({item.reminderTiming ?? 'day-of'})
                  </Text>
                ) : (
                  <Text style={styles.detailText}>
                    Threshold: ₱{item.priceThreshold != null ? item.priceThreshold.toFixed(2) : '0.00'} ({item.priceDirection})
                  </Text>
                )}
                {item.email ? <Text style={styles.emailText}>📧 {item.email}</Text> : null}
              </View>

              {/* Secondary History Row (T-04b writeback display) */}
              <View style={styles.historyBox}>
                <View style={styles.historyRow}>
                  <Ionicons name="time-outline" size={13} color={colors.onSurfaceVariant} />
                  <Text style={styles.historyText}>
                    Last checked: {formatTimestamp(item.lastCheckedAt)}
                  </Text>
                </View>
                <View style={styles.historyRow}>
                  <Ionicons
                    name={item.lastTriggeredAt ? 'checkmark-circle-outline' : 'ellipse-outline'}
                    size={13}
                    color={item.lastTriggeredAt ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.historyText, item.lastTriggeredAt && styles.historyTextTriggered]}>
                    Last triggered:{' '}
                    {item.lastTriggeredAt
                      ? `${formatTimestamp(item.lastTriggeredAt)}${
                          item.lastTriggeredValue != null ? ` (Value: ${item.lastTriggeredValue})` : ''
                        }`
                      : 'Never'}
                  </Text>
                </View>
              </View>

              {/* Card Footer Actions */}
              <View style={styles.cardFooter}>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleDeleteAlert(item);
                  }}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </Pressable>

                <View style={styles.viewDetailLink}>
                  <Text style={styles.viewDetailText}>View Stock</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
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
      paddingBottom: spacing.xl * 2,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      marginBottom: spacing.md,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.onSurface,
      paddingVertical: 6,
    },
    filterSection: {
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    filterLabel: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      width: 52,
    },
    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surface,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    chipTextActive: {
      fontFamily: fonts.bodySemiBold,
      color: colors.onPrimary,
    },
    summaryBar: {
      marginBottom: spacing.sm,
    },
    summaryText: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl * 2,
      paddingHorizontal: spacing.lg,
    },
    emptyTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: colors.onSurface,
      marginTop: spacing.md,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      marginTop: spacing.xs,
      textAlign: 'center',
      lineHeight: 18,
    },
    alertCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    alertCardPaused: {
      opacity: 0.75,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    badgeGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    tickerBadge: {
      backgroundColor: colors.primary + '20',
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.default,
    },
    tickerBadgeText: {
      fontFamily: fonts.bodyBold,
      fontSize: 13,
      color: colors.primary,
    },
    typeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing.xs + 2,
      paddingVertical: 2,
      borderRadius: radii.default,
      borderWidth: 1,
    },
    typeBadgeEvent: {
      borderColor: colors.primary + '40',
      backgroundColor: colors.primary + '10',
    },
    typeBadgePrice: {
      borderColor: colors.secondary + '40',
      backgroundColor: colors.secondary + '10',
    },
    typeBadgeText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: colors.onSurface,
    },
    headerRightActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    switchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    switchLabel: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.primary,
    },
    switchLabelPaused: {
      color: colors.onSurfaceVariant,
    },
    alertTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
      color: colors.onSurface,
      marginBottom: 4,
    },
    detailRow: {
      marginBottom: spacing.xs,
      gap: 2,
    },
    detailText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
    },
    emailText: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    historyBox: {
      backgroundColor: colors.background,
      borderRadius: radii.default,
      padding: spacing.xs + 2,
      marginVertical: spacing.xs,
      gap: 4,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    historyText: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.onSurfaceVariant,
    },
    historyTextTriggered: {
      fontFamily: fonts.bodyMedium,
      color: colors.onSurface,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.outline + '40',
    },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 2,
      paddingRight: spacing.sm,
    },
    deleteBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.error,
    },
    viewDetailLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    viewDetailText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.primary,
    },
  });
}
