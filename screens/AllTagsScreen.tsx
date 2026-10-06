// screens/AllTagsScreen.tsx
// Lists all stock tags across the portfolio with ticker counts.
// Tapping a tag reveals the list of tickers assigned to that tag, and tapping
// a ticker navigates directly to StockDetail.

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { SettingsStackParamList } from '../core/navigationTypes';
import { useStore } from '../core/StoreProvider';
import { useScreenViewLog } from '../core/useScreenViewLog';

type Props = NativeStackScreenProps<SettingsStackParamList, 'AllTags'>;

interface TagSummary {
  tag: string;
  tickerCount: number;
  mostRecentAssignedAt: string;
}

export default function AllTagsScreen({ route }: Props) {
  useScreenViewLog('AllTags');
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const navigation = useNavigation<any>();

  const [tagSummaries, setTagSummaries] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTag, setExpandedTag] = useState<string | null>(route.params?.tagFilter ?? null);
  const [tickersForTag, setTickersForTag] = useState<string[]>([]);
  const [tickersLoading, setTickersLoading] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const list = await store.getAllTagsWithCounts();
      setTagSummaries(list);
    } catch (e) {
      console.error('[AllTagsScreen] load failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [store]);

  useFocusEffect(
    useCallback(() => {
      loadTags();
    }, [loadTags])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadTags();
  };

  const handleToggleTag = async (tag: string) => {
    if (expandedTag === tag) {
      setExpandedTag(null);
      setTickersForTag([]);
      return;
    }
    setExpandedTag(tag);
    setTickersLoading(true);
    try {
      const list = await store.getTickersForTag(tag);
      setTickersForTag(list.map((item) => item.ticker));
    } catch (e) {
      console.error('[AllTagsScreen] getTickersForTag failed:', e);
      setTickersForTag([]);
    } finally {
      setTickersLoading(false);
    }
  };

  const handleNavigateTicker = (ticker: string) => {
    try {
      navigation.navigate('Dashboard', { screen: 'StockDetail', params: { ticker } });
    } catch (e) {
      console.error('[AllTagsScreen] navigate to StockDetail failed:', e);
    }
  };

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
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.header}>Stock Tags</Text>
      <Text style={styles.subtitle}>
        Group your stock watchlist and holdings by custom tags.
      </Text>

      {tagSummaries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="pricetag-outline" size={36} color={colors.onSurfaceVariant} />
          <Text style={styles.emptyTitle}>No Stock Tags Yet</Text>
          <Text style={styles.emptyText}>
            Open any StockDetail page and tap the "+" button in the tags section to add custom tags like #recession-proof or #growth.
          </Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {tagSummaries.map((item, index) => {
            const isExpanded = expandedTag === item.tag;
            const isLast = index === tagSummaries.length - 1;

            return (
              <View key={item.tag} style={[styles.tagItem, !isLast && styles.divider]}>
                <Pressable
                  style={styles.tagHeader}
                  onPress={() => handleToggleTag(item.tag)}
                >
                  <View style={styles.tagBadge}>
                    <Text style={styles.tagBadgeText}>{item.tag}</Text>
                  </View>
                  <Text style={styles.tickerCount}>
                    {item.tickerCount} {item.tickerCount === 1 ? 'stock' : 'stocks'}
                  </Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.onSurfaceVariant}
                  />
                </Pressable>

                {isExpanded && (
                  <View style={styles.tickersContainer}>
                    {tickersLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ padding: spacing.sm }} />
                    ) : tickersForTag.length === 0 ? (
                      <Text style={styles.emptyTickersText}>No active stocks with this tag.</Text>
                    ) : (
                      <View style={styles.tickerChipsRow}>
                        {tickersForTag.map((ticker) => (
                          <Pressable
                            key={ticker}
                            style={styles.tickerChip}
                            onPress={() => handleNavigateTicker(ticker)}
                          >
                            <Text style={styles.tickerChipText}>{ticker}</Text>
                            <Ionicons name="chevron-forward" size={14} color={colors.onPrimaryContainer} />
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
    scrollContent: { padding: spacing.md, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
    subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, marginBottom: spacing.lg },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.sm,
    },
    emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface },
    emptyText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 18,
    },
    listCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    tagItem: {
      backgroundColor: colors.surface,
    },
    divider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    tagHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    tagBadge: {
      backgroundColor: colors.primaryContainer,
      borderRadius: radii.full,
      paddingVertical: 4,
      paddingHorizontal: spacing.md,
    },
    tagBadgeText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onPrimaryContainer,
    },
    tickerCount: {
      flex: 1,
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      textAlign: 'right',
    },
    tickersContainer: {
      backgroundColor: colors.surfaceVariant,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
    emptyTickersText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      fontStyle: 'italic',
    },
    tickerChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    tickerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primaryContainer,
      borderRadius: radii.lg,
      paddingVertical: 6,
      paddingHorizontal: spacing.md,
      gap: 4,
    },
    tickerChipText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onPrimaryContainer,
    },
  });
