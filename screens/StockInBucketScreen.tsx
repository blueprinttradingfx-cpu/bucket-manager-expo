// screens/StockInBucketScreen.tsx
// Level 4 of the drill-down: one ticker, within one bucket, specifically.
// The most granular view - individual lots' worth (via the position summary)
// plus the actual dividend payment history for this ticker in this bucket.
// Reached from both BucketDetailScreen (tap a stock) and StockDetailScreen
// (tap a bucket within a stock's cross-bucket breakdown) - same screen,
// registered in both stacks. Restyled to match the Stitch design system
// (see DashboardScreen for the full rationale).

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useStore } from '../core/StoreProvider';
import { BucketStockPosition, ValuedStockPosition, applyPricesToPositions } from '../core/bucketLogic';
import { fetchPriceCache } from '../core/priceCache';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { colors, spacing, radii, fonts } from '../core/theme';

// Minimal structural prop type, not tied to either stack's specific
// NativeStackScreenProps - this screen is registered in BOTH
// DashboardStack and BucketsStack (reachable via two different drill-down
// paths), and only ever reads route.params, never calls navigation.navigate,
// so it doesn't need either stack's specific navigation type.
interface Props {
  route: { params: { bucket: string; ticker: string } };
}

export default function StockInBucketScreen({ route }: Props) {
  const { bucket, ticker } = route.params;
  useScreenViewLog('StockInBucket', { bucket, ticker });
  const store = useStore();
  const [position, setPosition] = useState<ValuedStockPosition | BucketStockPosition | null>(null);
  const [dividends, setDividends] = useState<{ date: string; amount: number }[]>([]);
  const [transactions, setTransactions] = useState<{ date: string; type: 'BUY' | 'SELL'; quantity: number; price: number; amount: number }[]>([]);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [positions, divHistory, txnHistory] = await Promise.all([
        store.getBucketPositions(bucket),
        store.getDividendHistory(bucket, ticker),
        store.getTransactionHistory(bucket, ticker),
      ]);
      const found = positions.find((p) => p.ticker === ticker) ?? null;
      setDividends(divHistory);
      setTransactions(txnHistory);

      if (found) {
        try {
          const prices = await fetchPriceCache();
          setPriceError(null);
          setPosition(applyPricesToPositions([found], prices.tickers)[0]);
        } catch (e: any) {
          console.log('[StockInBucket] price cache unavailable:', e.message);
          setPriceError(e.message);
          setPosition(found);
        }
      } else {
        setPosition(null);
      }
      setLoading(false);
    })();
  }, [store, bucket, ticker]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!position) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No current position for {ticker} in {bucket}.</Text>
      </View>
    );
  }

  const valued = 'marketValue' in position ? (position as ValuedStockPosition) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.ticker}>{ticker}</Text>
      <Text style={styles.bucketLabel}>{bucket}</Text>

      <View style={styles.statsRow}>
        <Stat label="Shares" value={String(position.totalQty)} />
        <Stat label="Avg Cost" value={`₱${position.avgCost}`} />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label={valued?.marketValue != null ? 'Market Value' : 'Cost Basis'}
          value={`₱${(valued?.marketValue ?? position.totalCostBasis).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          big
        />
        <Stat label="Dividends Earned" value={`₱${position.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} big sign="positive" />
      </View>
      {valued?.unrealizedGain != null && (
        <View style={styles.statsRow}>
          <Stat
            label="Unrealized Gain"
            value={`${valued.unrealizedGain >= 0 ? '+' : ''}₱${valued.unrealizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            sublabel={`${valued.unrealizedGainPct! >= 0 ? '+' : ''}${valued.unrealizedGainPct}%`}
            sign={valued.unrealizedGain >= 0 ? 'positive' : 'negative'}
          />
          <Stat
            label="Current Price"
            value={`₱${valued.currentPrice}`}
            sublabel={valued.currentYieldPct != null ? `yield ${valued.currentYieldPct}%` : undefined}
          />
        </View>
      )}
      {priceError && <Text style={styles.priceWarning}>Live prices unavailable - showing cost basis only.</Text>}

      <Text style={styles.sectionHeader}>Transaction History</Text>
      <FlatList
        data={transactions}
        keyExtractor={(t, i) => `${t.date}-${i}`}
        renderItem={({ item }) => (
          <View style={styles.txnRow}>
            <View style={styles.txnLeft}>
              <Text style={[styles.txnType, item.type === 'BUY' ? styles.positive : styles.negative]}>{item.type}</Text>
              <Text style={styles.txnDate}>{item.date}</Text>
            </View>
            <View style={styles.txnRight}>
              <Text style={styles.txnQty}>{item.quantity.toLocaleString()} sh</Text>
              <Text style={styles.txnPrice}>@ ₱{item.price}</Text>
              <Text style={[styles.txnAmount, item.type === 'BUY' ? styles.negative : styles.positive]}>
                {item.type === 'BUY' ? '-' : '+'}₱{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No buy/sell transactions recorded yet for this ticker in this bucket.</Text>}
        style={styles.list}
      />

      <Text style={styles.sectionHeader}>Dividend History</Text>
      <FlatList
        data={dividends}
        keyExtractor={(d, i) => `${d.date}-${i}`}
        renderItem={({ item }) => (
          <View style={styles.divRow}>
            <Text style={styles.divDate}>{item.date}</Text>
            <Text style={styles.divAmount}>₱{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No dividend payments recorded yet for this ticker in this bucket.</Text>}
      />
    </View>
  );
}

function Stat({ label, value, big, sublabel, sign }: {
  label: string; value: string; big?: boolean; sublabel?: string; sign?: 'positive' | 'negative';
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statValueBig, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{value}</Text>
      {sublabel && <Text style={[styles.statSublabel, sign === 'positive' && styles.positive, sign === 'negative' && styles.negative]}>{sublabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  ticker: { fontFamily: fonts.monoBold, fontSize: 26, color: colors.onBackground },
  bucketLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.xl, padding: spacing.md },
  statLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 16, color: colors.onSurface },
  statValueBig: { fontSize: 20 },
  statSublabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  priceWarning: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.negative, marginBottom: spacing.sm },
  sectionHeader: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onSurfaceVariant, marginTop: spacing.sm, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.3 },
  list: { marginBottom: spacing.md },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.base,
  },
  txnLeft: { flex: 1 },
  txnType: { fontFamily: fonts.monoBold, fontSize: 12, textTransform: 'uppercase', marginBottom: 2 },
  txnDate: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  txnRight: { alignItems: 'flex-end' },
  txnQty: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
  txnPrice: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 },
  txnAmount: { fontFamily: fonts.monoSemiBold, fontSize: 14, marginTop: 2 },
  divRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.base,
  },
  divDate: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  divAmount: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.positive },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
});
