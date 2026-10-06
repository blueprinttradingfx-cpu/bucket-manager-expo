// screens/StockDetailScreen.tsx
// Level 3 of the drill-down: one ticker, merged across every bucket that
// holds it. Restyled to match the Stitch design system (see
// DashboardScreen for the full rationale). Includes live valuation
// (market value, unrealized gain, current yield) when the price cache is
// reachable - degrades gracefully to cost-basis-only otherwise. The
// "Held In" list uses the same Positions table component as the other two
// screens, just with rows keyed by bucket instead of ticker.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable, StyleProp, ViewStyle } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Alert from '../core/alert';
import { useStore } from '../core/StoreProvider';
import { AggregatedStock, ValuedAggregatedStock, ValuedStockPosition, BucketStockPosition, applyPricesToAggregated, computePortfolioValuation, YieldBracket } from '../core/bucketLogic';
import { WatchlistItem, StockNote, StockAlert, StockTrackerEntry } from '../core/storeApi';
import { fetchPriceCache, PriceEntry } from '../core/priceCache';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import PositionsTable, { PositionItem, ExpandedRow } from './components/PositionsTable';
import BucketSuggestion from './components/BucketSuggestion';
import WatchlistSection from './components/WatchlistSection';
import StockNotesSection from './components/StockNotesSection';
import CompanyDetailsSection from './components/CompanyDetailsSection';
import AskAiModal from './components/AskAiModal';
import DataDisclaimer from './components/DataDisclaimer';
import { buildStockDetailPrompt, StockPositionSummary } from '../core/askAiPrompts';
import { fetchCompanyDetails } from '../core/companyDetailsCache';
import { Ionicons } from '@expo/vector-icons';
import TagEditorDialog from './components/TagEditorDialog';
import AlertsSection from './components/AlertsSection';
import { useNavigation } from '@react-navigation/native';

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

// The "all transactions of this stock" table below Held In - every bucket's
// buy/sell history for this one ticker, merged. getTransactionHistory is
// per-bucket, so `bucket` gets stitched on here by the caller since the
// store method itself doesn't know which bucket it was called for.
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

export default function StockDetailScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
  useScreenViewLog('StockDetail', { ticker });
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  // T-07: used for cross-tab navigate back to Tracker screen from alert chip
  const rootNav = useNavigation<any>();
  const [stock, setStock] = useState<AggregatedStock | ValuedAggregatedStock | null>(null);
  const [buckets, setBuckets] = useState<YieldBracket[]>([]);
  const [priceEntry, setPriceEntry] = useState<PriceEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlistItem, setWatchlistItem] = useState<WatchlistItem | null>(null);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [notes, setNotes] = useState<StockNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [txnHistory, setTxnHistory] = useState<TickerTxnRow[]>([]);
  const [txnSortKey, setTxnSortKey] = useState<TxnSortKey>('date');
  const [txnSortDir, setTxnSortDir] = useState<'asc' | 'desc'>('desc');
  const [showAskAi, setShowAskAi] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [allAppTags, setAllAppTags] = useState<{ tag: string; tickerCount: number }[]>([]);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  // T-07: tracker entry for this ticker — used to show "Linked from Tracker" chip on alerts
  const [trackerEntry, setTrackerEntry] = useState<StockTrackerEntry | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        store.getTagsForTicker(ticker),
        store.getAllTagsWithCounts(),
      ]).then(([tList, appTags]) => {
        if (!cancelled) {
          setTags(tList.map((t) => t.tag));
          setAllAppTags(appTags);
        }
      });
      return () => { cancelled = true; };
    }, [store, ticker])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setAlertsLoading(true);
      // T-07: load alerts + tracker entry for this ticker in parallel
      Promise.all([
        store.getAlertsForTicker(ticker),
        store.getStockTrackerForTicker(ticker),
      ]).then(([list, entry]) => {
        if (!cancelled) {
          setAlerts(list);
          setTrackerEntry(entry);
          setAlertsLoading(false);
        }
      }).catch(() => { if (!cancelled) setAlertsLoading(false); });
      return () => { cancelled = true; };
    }, [store, ticker])
  );

  // T-07: set of alert IDs that were auto-created by the tracker entry for this ticker.
  // Used by AlertsSection to show the "Linked from Stock Tracker" chip.
  const linkedAlertIds = useMemo<Set<string>>(() => {
    if (trackerEntry?.priceAlertId) return new Set([trackerEntry.priceAlertId]);
    return new Set();
  }, [trackerEntry]);

  // T-07: navigate to the Stock Tracker tab, using root navigator.
  // Cast to 'any' because this screen lives in multiple stacks and we only
  // need a tab-level navigate — no param is needed for the tab root.
  const handleNavigateToTracker = useCallback(() => {
    try {
      rootNav.navigate('StockTracker' as any);
    } catch (e) {
      console.log('[StockDetail] T-07 navigate to tracker failed:', e);
    }
  }, [rootNav]);

  async function handleSaveTags(newTags: string[]) {

    try {
      await store.setTagsForTicker(ticker, newTags);
      setTags(newTags);
      const appTags = await store.getAllTagsWithCounts();
      setAllAppTags(appTags);
    } catch (e: any) {
      Alert.alert('Could not save tags', e.message ?? String(e));
    }
  }

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

      // Every bucket that's EVER transacted this ticker (found.buckets
      // includes fully-exited, zero-share ones too - see getStockHistory's
      // doc comment) - getTransactionHistory is per-bucket, so this is one
      // call per bucket, same N+1-but-parallelized pattern as the Dashboard/
      // BucketsScreen growth-stage fetch.
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
          console.log('[StockDetail] transaction history unavailable:', e.message);
          setTxnHistory([]);
        }
      } else {
        setTxnHistory([]);
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

  // Notes are only ever added/edited/deleted from this screen (unlike
  // watchlist status, which can also change from the Watch List tab), so a
  // plain mount/ticker-change effect is enough - no useFocusEffect needed.
  useEffect(() => {
    let cancelled = false;
    setNotesLoading(true);
    store.getStockNotes(ticker).then((list) => {
      if (!cancelled) {
        setNotes(list);
        setNotesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [store, ticker]);

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

  async function handleAddNote(html: string) {
    try {
      const note = await store.addStockNote(ticker, html);
      setNotes((prev) => [note, ...prev]);
    } catch (e: any) {
      Alert.alert('Could not save note', e.message ?? String(e));
    }
  }

  async function handleUpdateNote(id: string, html: string) {
    try {
      await store.updateStockNote(id, html);
      const updatedAt = new Date().toISOString();
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, contentHtml: html, updatedAt } : n)));
    } catch (e: any) {
      Alert.alert('Could not save note', e.message ?? String(e));
    }
  }

  async function handleDeleteNote(id: string) {
    try {
      await store.deleteStockNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e: any) {
      Alert.alert('Could not delete note', e.message ?? String(e));
    }
  }

  async function handleAddAlert(alert: Omit<StockAlert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    try {
      const created = await store.addStockAlert(alert);
      setAlerts((prev) => [created, ...prev]);
    } catch (e: any) {
      Alert.alert('Could not save alert', e.message ?? String(e));
    }
  }

  async function handleUpdateAlert(
    id: string,
    updates: Partial<Pick<StockAlert, 'title' | 'eventDate' | 'eventTime' | 'reminderTiming' | 'priceDirection' | 'priceThreshold' | 'email' | 'status'>>
  ) {
    try {
      await store.updateStockAlert(id, updates);
      const updatedAt = new Date().toISOString();
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates, updatedAt } : a)));
    } catch (e: any) {
      Alert.alert('Could not update alert', e.message ?? String(e));
    }
  }

  async function handleDeleteAlert(id: string) {
    try {
      await store.deleteStockAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      Alert.alert('Could not delete alert', e.message ?? String(e));
    }
  }

  const sortedTxnHistory = useMemo(() => {
    const rows = [...txnHistory];
    rows.sort((a, b) => {
      const cmp = txnSortKey === 'bucket' ? a.bucket.localeCompare(b.bucket)
        : txnSortKey === 'date' ? a.date.localeCompare(b.date) // ISO dates - string compare sorts correctly
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
      // Newest-first is the useful default for date (matches every other
      // transaction feed in the app); bucket/price default to ascending
      // (A-Z, lowest first) since there's no equivalent "natural" direction.
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

        <View style={styles.tagContainer}>
          {tags.map((t) => (
            <Pressable key={t} style={styles.tagChip} onPress={() => setShowTagEditor(true)}>
              <Text style={styles.tagChipText}>{t}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.addTagBtn} onPress={() => setShowTagEditor(true)}>
            <Ionicons name="add" size={14} color={colors.primary} />
            <Text style={styles.addTagBtnText}>{tags.length === 0 ? 'Add Tags' : 'Edit'}</Text>
          </Pressable>
        </View>

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

        <Pressable style={styles.askAiButton} onPress={() => setShowAskAi(true)}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          <Text style={styles.askAiButtonText}>Ask AI About {ticker}</Text>
        </Pressable>

        <CompanyDetailsSection ticker={ticker} />

        <Text style={styles.positionsHeader}>Held In</Text>
        <PositionsTable items={[]} onItemPress={() => {}} emptyText="Not currently held in any bucket." />

        <View style={styles.notesCard}>
          <StockNotesSection
            notes={notes}
            loading={notesLoading}
            onAdd={handleAddNote}
            onUpdate={handleUpdateNote}
            onDelete={handleDeleteNote}
          />
        </View>

        <View style={styles.notesCard}>
          <AlertsSection
            alerts={alerts}
            loading={alertsLoading}
            ticker={ticker}
            onAdd={handleAddAlert}
            onUpdate={handleUpdateAlert}
            onDelete={handleDeleteAlert}
            linkedAlertIds={linkedAlertIds}
            onNavigateToTracker={handleNavigateToTracker}
          />
        </View>

        <AskAiModal
          visible={showAskAi}
          onClose={() => setShowAskAi(false)}
          title={`Ask AI About ${ticker}`}
          loadPrompt={async () => {
            const details = await fetchCompanyDetails(ticker);
            return buildStockDetailPrompt({
              ticker,
              priceEntry,
              details,
              position: null,
              buyBelowTarget: watchlistItem?.buyBelowPrice ?? null,
            });
          }}
        />
        <TagEditorDialog
          visible={showTagEditor}
          ticker={ticker}
          initialTags={tags}
          allAppTags={allAppTags}
          onClose={() => setShowTagEditor(false)}
          onSaveTags={handleSaveTags}
        />
        <DataDisclaimer />
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

      <View style={styles.tagContainer}>
        {tags.map((t) => (
          <Pressable key={t} style={styles.tagChip} onPress={() => setShowTagEditor(true)}>
            <Text style={styles.tagChipText}>{t}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.addTagBtn} onPress={() => setShowTagEditor(true)}>
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={styles.addTagBtnText}>{tags.length === 0 ? 'Add Tags' : 'Edit'}</Text>
        </Pressable>
      </View>

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

      <Pressable style={styles.askAiButton} onPress={() => setShowAskAi(true)}>
        <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
        <Text style={styles.askAiButtonText}>Ask AI About {stock.ticker}</Text>
      </Pressable>

      <CompanyDetailsSection ticker={stock.ticker} />

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

      <View style={styles.notesCard}>
        <StockNotesSection
          notes={notes}
          loading={notesLoading}
          onAdd={handleAddNote}
          onUpdate={handleUpdateNote}
          onDelete={handleDeleteNote}
        />
      </View>

      <View style={styles.notesCard}>
        <AlertsSection
          alerts={alerts}
          loading={alertsLoading}
          ticker={stock.ticker}
          onAdd={handleAddAlert}
          onUpdate={handleUpdateAlert}
          onDelete={handleDeleteAlert}
          linkedAlertIds={linkedAlertIds}
          onNavigateToTracker={handleNavigateToTracker}
        />
      </View>

      <AskAiModal
        visible={showAskAi}
        onClose={() => setShowAskAi(false)}
        title={`Ask AI About ${stock.ticker}`}
        loadPrompt={async () => {
          const details = await fetchCompanyDetails(stock.ticker);
          const position: StockPositionSummary | null = stock.totalQty > 0 ? {
            qty: stock.totalQty,
            avgCost: stock.avgCost,
            marketValue: valued?.marketValue ?? null,
            unrealizedGainPct: valuation?.totalUnrealizedGainPct ?? null,
            totalDividends: stock.totalDividends,
            bucketCount: activeBucketCount,
          } : null;
          return buildStockDetailPrompt({
            ticker: stock.ticker,
            priceEntry,
            details,
            position,
            buyBelowTarget: watchlistItem?.buyBelowPrice ?? null,
          });
        }}
      />
      <TagEditorDialog
        visible={showTagEditor}
        ticker={stock.ticker}
        initialTags={tags}
        allAppTags={allAppTags}
        onClose={() => setShowTagEditor(false)}
        onSaveTags={handleSaveTags}
      />
      <DataDisclaimer />
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
        <Text style={[styles.txnTableHeaderText, styles.txnTableColShares]}>Shares</Text>
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
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md, marginTop: -2 },
  tagChip: { backgroundColor: colors.primaryContainer, borderRadius: radii.full, paddingVertical: 4, paddingHorizontal: spacing.sm },
  tagChipText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onPrimaryContainer },
  addTagBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceVariant, borderRadius: radii.full, paddingVertical: 4, paddingHorizontal: spacing.sm, gap: 2, borderWidth: 1, borderColor: colors.outlineVariant },
  addTagBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.primary },
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
  askAiButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.lg,
  },
  askAiButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.primary },
  positionsHeader: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground, marginTop: spacing.xs, marginBottom: spacing.md },
  notesCard: { marginTop: spacing.lg },
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
