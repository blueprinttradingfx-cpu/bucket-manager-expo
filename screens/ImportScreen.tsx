// screens/ImportScreen.tsx
// The exact workflow requested during scoping: select bucket -> import file.
// Shows inserted vs. skipped-duplicate counts so a re-import is visibly safe
// rather than a silent no-op that leaves you wondering if it worked.
// Also supports manual transaction entry for missing transactions.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, TextInput, ScrollView, Modal } from 'react-native';
import Alert from '../core/alert';
import { useStore } from '../core/StoreProvider';
import { pickStatementFile, parseStatementFile } from '../core/xlsxImport';
import { useScreenViewLog } from '../core/useScreenViewLog';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { fetchPriceCache } from '../core/priceCache';
import { fetchDividendHistory, getDividendHistoryForTicker } from '../core/dividendHistory';
import { simulateDividends, SimpleTxn } from '../core/dividendSimulation';
import { isValidIsoDate } from '../core/dateUtils';

interface BucketRow { id: number; name: string }

export default function ImportScreen() {
  useScreenViewLog('Import');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTxns, setManualTxns] = useState<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }[]>([]);
  const [txnType, setTxnType] = useState<'BUY' | 'SELL' | 'CASH DIVIDEND'>('BUY');
  const [stock, setStock] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [priceCache, setPriceCache] = useState<Record<string, any> | null>(null);
  const [showStockPicker, setShowStockPicker] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [editingTxn, setEditingTxn] = useState<{ id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null } | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [fundFills, setFundFills] = useState<{ id: number; date: string; stock: string; description: string | null; amount: number; quantity: number | null; price: number | null }[]>([]);
  const [fillQty, setFillQty] = useState<Record<number, string>>({});
  const [fillPrice, setFillPrice] = useState<Record<number, string>>({});
  const [savingFillId, setSavingFillId] = useState<number | null>(null);
  const [fundFillTab, setFundFillTab] = useState<'unsettled' | 'settled'>('unsettled');

  const refresh = useCallback(async () => {
    const b = await store.listBuckets();
    setBuckets(b);
    if (!selected && b.length) setSelected(b[0].name);
    if (selected) {
      setManualTxns(await store.getManualTransactions(selected));
      setFundFills(await store.getFundFills(selected));
    }
  }, [store, selected]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    fetchPriceCache().then(cache => {
      setPriceCache(cache.tickers);
    }).catch(err => {
      console.error('Failed to fetch price cache:', err);
    });
  }, []);

  async function handleAddManual() {
    if (!selected) return Alert.alert('Select a bucket first');
    if (!stock || !stock.trim()) return Alert.alert('Stock symbol is required');
    if (!date) return Alert.alert('Date is required');
    if (!isValidIsoDate(date)) {
      return Alert.alert('Invalid date', 'Enter a full date as YYYY-MM-DD, e.g. 2024-08-01 - not just a year.');
    }

    const qtyNum = quantity ? parseFloat(quantity) : undefined;
    const priceNum = price ? parseFloat(price) : undefined;
    let amountNum = amount ? parseFloat(amount) : undefined;

    if (txnType !== 'CASH DIVIDEND' && (qtyNum === undefined || priceNum === undefined)) {
      return Alert.alert('Quantity and price are required for BUY/SELL transactions');
    }
    if (txnType === 'CASH DIVIDEND' && amountNum === undefined) {
      return Alert.alert('Amount is required for dividend transactions');
    }

    if (txnType === 'SELL' && qtyNum !== undefined) {
      try {
        const { holdings } = await store.getBucketHoldings(selected);
        const held = holdings.find((h) => h.ticker === stock.trim())?.totalQty ?? 0;
        if (held <= 0) {
          return Alert.alert('No holding to sell', `You don't currently hold any ${stock.trim()} in ${selected} - add a BUY transaction first.`);
        }
        if (qtyNum > held) {
          return Alert.alert('Not enough shares', `You're trying to sell ${qtyNum} shares of ${stock.trim()}, but only hold ${held} in ${selected}.`);
        }
      } catch (e: any) {
        return Alert.alert('Could not verify holding', e.message);
      }
    }

    // Store the trade's total value so it displays correctly elsewhere (Transaction
    // History shows -amount for BUY / +amount for SELL) - previously this was left
    // undefined for BUY/SELL and always showed ₱0.00.
    if (txnType !== 'CASH DIVIDEND' && amountNum === undefined && qtyNum !== undefined && priceNum !== undefined) {
      amountNum = Math.round(qtyNum * priceNum * 100) / 100;
    }

    try {
      await store.addManualTransaction(selected, txnType, stock.trim(), date, qtyNum, priceNum, amountNum);
      setStock('');
      setQuantity('');
      setPrice('');
      setAmount('');
      setDate(new Date().toISOString().split('T')[0]);
      await refresh();
      Alert.alert('Success', 'Transaction added successfully');
    } catch (e: any) {
      Alert.alert('Failed to add transaction', e.message);
    }
  }

  async function handleDeleteManual(txnId: number) {
    Alert.alert('Delete Transaction', 'Are you sure you want to delete this manually added transaction?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await store.deleteManualTransaction(txnId);
            await refresh();
            Alert.alert('Success', 'Transaction deleted successfully');
          } catch (e: any) {
            Alert.alert('Failed to delete', e.message);
          }
        },
      },
    ]);
  }

  function handleEditManual(txn: { id: number; date: string; type: string; stock: string; quantity: number | null; price: number | null; amount: number | null }) {
    setEditingTxn(txn);
    setEditDate(txn.date || '');
    setEditQuantity(txn.quantity != null ? String(txn.quantity) : '');
    setEditPrice(txn.price != null ? String(txn.price) : '');
    setEditAmount(txn.amount != null ? String(txn.amount) : '');
  }

  async function handleSaveEdit() {
    if (!editingTxn) return;
    if (editDate && !isValidIsoDate(editDate)) {
      return Alert.alert('Invalid date', 'Enter a full date as YYYY-MM-DD, e.g. 2024-08-01 - not just a year.');
    }

    const updates: { date?: string; quantity?: number | null; price?: number | null; amount?: number | null } = {};

    if (editDate !== editingTxn.date) updates.date = editDate;
    if (editQuantity !== (editingTxn.quantity != null ? String(editingTxn.quantity) : '')) {
      updates.quantity = editQuantity ? parseFloat(editQuantity) : null;
    }
    if (editPrice !== (editingTxn.price != null ? String(editingTxn.price) : '')) {
      updates.price = editPrice ? parseFloat(editPrice) : null;
    }
    if (editAmount !== (editingTxn.amount != null ? String(editingTxn.amount) : '')) {
      updates.amount = editAmount ? parseFloat(editAmount) : null;
    }

    // For BUY/SELL, amount represents the trade's total value - keep it in sync
    // whenever quantity or price changes, instead of letting it go stale.
    if (editingTxn.type !== 'CASH DIVIDEND' && (updates.quantity !== undefined || updates.price !== undefined)) {
      const finalQty = updates.quantity !== undefined ? updates.quantity : editingTxn.quantity;
      const finalPrice = updates.price !== undefined ? updates.price : editingTxn.price;
      if (finalQty != null && finalPrice != null) {
        updates.amount = Math.round(finalQty * finalPrice * 100) / 100;
      }
    }

    if (Object.keys(updates).length === 0) {
      setEditingTxn(null);
      return;
    }

    try {
      await store.updateManualTransaction(editingTxn.id, updates);
      setEditingTxn(null);
      await refresh();
      Alert.alert('Success', 'Transaction updated successfully');
    } catch (e: any) {
      Alert.alert('Failed to update', e.message);
    }
  }

  function handleCancelEdit() {
    setEditingTxn(null);
  }

  async function handleSimulateDividends() {
    if (!selected) return Alert.alert('Select a bucket first');
    setSimulating(true);
    try {
      const allManual = await store.getManualTransactions(selected);
      const buySellRaw = allManual.filter((t) => (t.type === 'BUY' || t.type === 'SELL') && t.quantity != null);
      const badDateTickers = [...new Set(buySellRaw.filter((t) => !t.date || !isValidIsoDate(t.date)).map((t) => t.stock))];
      const buySell = buySellRaw.filter((t) => t.date && isValidIsoDate(t.date));
      const tickersWithBuys = [...new Set(buySell.filter((t) => t.type === 'BUY').map((t) => t.stock))];

      if (tickersWithBuys.length === 0) {
        Alert.alert('Nothing to simulate', 'Add a manual BUY transaction first - dividends are simulated based on shares held over time.');
        return;
      }

      // Dedupe key is ticker+date, not just date - two different tickers
      // can legitimately pay a dividend on the same day.
      const existingDividendKeys = new Set(
        allManual.filter((t) => t.type === 'CASH DIVIDEND').map((t) => `${t.stock}|${t.date}`)
      );

      const historyCache = await fetchDividendHistory();
      let insertedCount = 0;
      let tickersWithHistory = 0;
      const tickerDateProblems: string[] = [];

      for (const ticker of tickersWithBuys) {
        const history = getDividendHistoryForTicker(historyCache, ticker);
        if (history.length === 0) continue;
        tickersWithHistory++;

        const tickerTxns: SimpleTxn[] = buySell
          .filter((t) => t.stock === ticker)
          .map((t) => ({ date: t.date, type: t.type as 'BUY' | 'SELL', quantity: t.quantity! }));

        const { dividends: simulated, unparseableTxnDates } = simulateDividends(tickerTxns, history);
        if (unparseableTxnDates.length > 0) {
          tickerDateProblems.push(`${ticker} (${unparseableTxnDates.join(', ')})`);
        }
        for (const div of simulated) {
          if (!div.date || !isValidIsoDate(div.date)) {
            tickerDateProblems.push(`${ticker} (simulated dividend had no valid date)`);
            continue; // never persist a transaction with a missing/bad date
          }
          const key = `${ticker}|${div.date}`;
          if (existingDividendKeys.has(key)) continue; // already simulated (or manually entered) - don't duplicate on repeat runs
          await store.addManualTransaction(selected, 'CASH DIVIDEND', ticker, div.date, undefined, undefined, div.totalAmount);
          existingDividendKeys.add(key);
          insertedCount++;
        }
      }

      await refresh();
      const badDateNote = badDateTickers.length > 0
        ? `\n\nSkipped ${badDateTickers.join(', ')} - has a BUY/SELL with a missing or invalid date. Edit that transaction to YYYY-MM-DD and run again.`
        : '';
      if (insertedCount > 0) {
        Alert.alert(
          'Dividends Simulated',
          `Added ${insertedCount} dividend payment${insertedCount === 1 ? '' : 's'} across ${tickersWithHistory} ticker${tickersWithHistory === 1 ? '' : 's'}, based on real dividend history and shares actually held on each ex-date.`
          + (tickerDateProblems.length > 0 ? `\n\nSkipped some transactions with unreadable dates: ${tickerDateProblems.join('; ')}. Edit them to YYYY-MM-DD and run again.` : '')
          + badDateNote
        );
      } else if (tickerDateProblems.length > 0) {
        // This is the case that used to show a misleading "everything
        // eligible is already recorded" - it wasn't recorded, the date(s)
        // just couldn't be parsed, so nothing was ever eligible in the
        // first place. Say that plainly instead.
        Alert.alert(
          'Some transaction dates need fixing',
          `Couldn't read the date on: ${tickerDateProblems.join('; ')}. Use the pencil icon to edit it to a full YYYY-MM-DD date (e.g. 2024-08-01, not just "2024"), then run Simulate Dividends again.`
          + badDateNote
        );
      } else if (tickersWithHistory === 0) {
        Alert.alert('No dividend history found', `None of your manually-bought tickers (${tickersWithBuys.join(', ')}) were found in the dividend history data.` + badDateNote);
      } else {
        Alert.alert('Up to date', 'No new dividend payments to simulate - everything eligible is already recorded.' + badDateNote);
      }
    } catch (e: any) {
      Alert.alert('Simulation failed', e.message ?? String(e));
    } finally {
      setSimulating(false);
    }
  }

  async function handleImport() {
    if (!selected) {
      console.log('[ImportScreen] no bucket selected, aborting');
      return Alert.alert('Select a bucket first');
    }
    console.log('[ImportScreen] opening picker for bucket:', selected);
    const file = await pickStatementFile();
    if (!file) {
      console.log('[ImportScreen] picker returned null (user cancelled or picker failed silently)');
      return;
    }
    console.log('[ImportScreen] picked file:', file.name);

    setBusy(true);
    setLastResult(null);
    try {
      const rows = await parseStatementFile(file.uri);
      console.log('[ImportScreen] parsed', rows.length, 'rows, importing into store');
      const { inserted, skippedDuplicates } = await store.importIntoBucket(selected, rows);
      console.log('[ImportScreen] import complete:', { inserted, skippedDuplicates });
      setLastResult(
        `${file.name}: ${inserted} new transaction${inserted === 1 ? '' : 's'} imported` +
        (skippedDuplicates > 0 ? `, ${skippedDuplicates} already-imported row${skippedDuplicates === 1 ? '' : 's'} skipped` : '')
      );
    } catch (e: any) {
      console.error('[ImportScreen] import failed:', e);
      Alert.alert('Import failed', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveFundFill(id: number, amount: number) {
    const qtyStr = (fillQty[id] ?? '').trim();
    const priceStr = (fillPrice[id] ?? '').trim();
    if (!qtyStr && !priceStr) {
      return Alert.alert('Enter units or NAVPU', 'Fill in at least one - the other is calculated from the amount already on file for this buy.');
    }

    let qty = qtyStr ? parseFloat(qtyStr) : NaN;
    let unitPrice = priceStr ? parseFloat(priceStr) : NaN;

    // Only one side is required - the amount already on file (from the
    // statement) fills in whichever side is missing, same as how DragonFi
    // itself derives units = amount / NAVPU on settlement.
    if (!isNaN(qty) && isNaN(unitPrice)) unitPrice = qty > 0 ? amount / qty : NaN;
    if (isNaN(qty) && !isNaN(unitPrice)) qty = unitPrice > 0 ? amount / unitPrice : NaN;

    if (isNaN(qty) || isNaN(unitPrice) || qty <= 0 || unitPrice <= 0) {
      return Alert.alert('Invalid values', 'Enter a positive number of units and/or NAVPU.');
    }

    setSavingFillId(id);
    try {
      await store.updateFundTransaction(id, Math.round(qty * 10000) / 10000, Math.round(unitPrice * 10000) / 10000);
      setFillQty((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setFillPrice((prev) => { const next = { ...prev }; delete next[id]; return next; });
      await refresh();
    } catch (e: any) {
      Alert.alert('Failed to update', e.message ?? String(e));
    } finally {
      setSavingFillId(null);
    }
  }

  if (buckets.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Set up at least one bucket first, on the Buckets tab.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Import Statement</Text>
      <Text style={styles.label}>Bucket</Text>
      <FlatList
        horizontal
        data={buckets}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.chip, selected === item.name && styles.chipSelected]}
            onPress={() => setSelected(item.name)}
          >
            <Text style={[styles.chipText, selected === item.name && styles.chipTextSelected]}>
              {item.name}
            </Text>
          </Pressable>
        )}
        style={styles.chipRow}
      />

      <Pressable style={styles.button} onPress={handleImport} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Select File to Import</Text>}
      </Pressable>

      {lastResult && <Text style={styles.result}>{lastResult}</Text>}

      {fundFills.length > 0 && (() => {
        const unsettled = fundFills.filter((f) => !(f.quantity != null && f.price != null));
        const settled = fundFills.filter((f) => f.quantity != null && f.price != null);
        const visible = fundFillTab === 'unsettled' ? unsettled : settled;
        return (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Fund Prices Needed</Text>
            <Text style={styles.simulateHint}>
              Fund buys come in with a peso amount but no units/NAVPU until DragonFi backfills it on settlement. Check the DragonFi dashboard and enter what you see below so the dashboard values these accurately - already-settled ones are shown too, in case you need to correct a value. You only need to fill in one field - the other is calculated from the amount already on file.
            </Text>
            <View style={styles.fundTabRow}>
              <Pressable
                style={[styles.fundTab, fundFillTab === 'unsettled' && styles.fundTabSelected]}
                onPress={() => setFundFillTab('unsettled')}
              >
                <Text style={[styles.fundTabText, fundFillTab === 'unsettled' && styles.fundTabTextSelected]}>
                  Unsettled ({unsettled.length})
                </Text>
              </Pressable>
              <Pressable
                style={[styles.fundTab, fundFillTab === 'settled' && styles.fundTabSelected]}
                onPress={() => setFundFillTab('settled')}
              >
                <Text style={[styles.fundTabText, fundFillTab === 'settled' && styles.fundTabTextSelected]}>
                  Settled ({settled.length})
                </Text>
              </Pressable>
            </View>
            {visible.length === 0 && (
              <Text style={styles.empty}>
                {fundFillTab === 'unsettled' ? 'All caught up - nothing waiting on a price.' : 'No settled entries yet.'}
              </Text>
            )}
            {visible.map((f) => {
              const isSettled = f.quantity != null && f.price != null;
              return (
                <View key={f.id} style={styles.txnRow}>
                  <View style={styles.editForm}>
                    <View style={styles.fundRowHeader}>
                      <Text style={styles.txnStock}>{f.stock}</Text>
                      {isSettled && <Text style={styles.simulateButtonText}>✓ Settled</Text>}
                    </View>
                    {f.description && <Text style={styles.txnDate}>{f.description}</Text>}
                    <Text style={styles.txnDate}>
                      {f.date} · ₱{f.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} invested
                    </Text>
                    <Text style={styles.editLabel}>Units (from DragonFi)</Text>
                    <TextInput
                      style={styles.editInput}
                      value={fillQty[f.id] ?? (f.quantity != null ? String(f.quantity) : '')}
                      onChangeText={(v) => setFillQty((prev) => ({ ...prev, [f.id]: v }))}
                      placeholder="e.g. 1234.5678"
                      placeholderTextColor={colors.onSurfaceVariant}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.editLabel}>NAVPU (leave blank to auto-calc)</Text>
                    <TextInput
                      style={styles.editInput}
                      value={fillPrice[f.id] ?? (f.price != null ? String(f.price) : '')}
                      onChangeText={(v) => setFillPrice((prev) => ({ ...prev, [f.id]: v }))}
                      placeholder="e.g. 1.2345"
                      placeholderTextColor={colors.onSurfaceVariant}
                      keyboardType="decimal-pad"
                    />
                    <Pressable
                      style={styles.saveButton}
                      onPress={() => handleSaveFundFill(f.id, f.amount)}
                      disabled={savingFillId === f.id}
                    >
                      {savingFillId === f.id ? (
                        <ActivityIndicator color={colors.onPrimary} />
                      ) : (
                        <Text style={styles.saveButtonText}>{isSettled ? 'Update' : 'Save'}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        );
      })()}

      <View style={styles.divider} />

      <Pressable style={styles.toggleButton} onPress={() => setShowManualForm(!showManualForm)}>
        <Text style={styles.toggleButtonText}>{showManualForm ? 'Hide' : 'Add Manual Transaction'}</Text>
        <Ionicons name={showManualForm ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </Pressable>

      {showManualForm && (
        <View style={styles.form}>
          <Text style={styles.label}>Transaction Type</Text>
          <View style={styles.typeRow}>
            {(['BUY', 'SELL', 'CASH DIVIDEND'] as const).map((type) => (
              <Pressable
                key={type}
                style={[styles.typeChip, txnType === type && styles.typeChipSelected]}
                onPress={() => setTxnType(type)}
              >
                <Text style={[styles.typeChipText, txnType === type && styles.typeChipTextSelected]}>{type}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Stock Symbol</Text>
          <Pressable style={styles.input} onPress={() => setShowStockPicker(true)}>
            <Text style={[styles.inputText, !stock && styles.placeholderText]}>{stock || 'Select stock...'}</Text>
          </Pressable>

          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.onSurfaceVariant}
            value={date}
            onChangeText={setDate}
          />

          {txnType !== 'CASH DIVIDEND' && (
            <>
              <Text style={styles.label}>Number of Shares</Text>
              <TextInput
                style={styles.input}
                placeholder="Quantity"
                placeholderTextColor={colors.onSurfaceVariant}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>Price per Share</Text>
              <TextInput
                style={styles.input}
                placeholder="Price"
                placeholderTextColor={colors.onSurfaceVariant}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
            </>
          )}

          {txnType === 'CASH DIVIDEND' && (
            <>
              <Text style={styles.label}>Dividend Amount</Text>
              <TextInput
                style={styles.input}
                placeholder="Amount"
                placeholderTextColor={colors.onSurfaceVariant}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
            </>
          )}

          <Pressable style={styles.addButton} onPress={handleAddManual}>
            <Text style={styles.addButtonText}>Add Transaction</Text>
          </Pressable>
        </View>
      )}

      {manualTxns.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>Manual Transactions</Text>
            <Pressable style={styles.simulateButton} onPress={handleSimulateDividends} disabled={simulating}>
              {simulating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
                  <Text style={styles.simulateButtonText}>Simulate Dividends</Text>
                </>
              )}
            </Pressable>
          </View>
          <Text style={styles.simulateHint}>
            Fills in realistic dividend payments for manually-bought stocks, based on real dividend history and how many shares you actually held on each payment's ex-date.
          </Text>
          {manualTxns.map((txn) => (
            <View key={txn.id} style={styles.txnRow}>
              {editingTxn?.id === txn.id ? (
                <View style={styles.editForm}>
                  <Text style={styles.editLabel}>Date</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editDate}
                    onChangeText={setEditDate}
                    placeholder="YYYY-MM-DD"
                  />
                  {txn.type !== 'CASH DIVIDEND' && (
                    <>
                      <Text style={styles.editLabel}>Shares</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editQuantity}
                        onChangeText={setEditQuantity}
                        placeholder="Quantity"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.editLabel}>Price</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editPrice}
                        onChangeText={setEditPrice}
                        placeholder="Price"
                        keyboardType="decimal-pad"
                      />
                    </>
                  )}
                  {txn.type === 'CASH DIVIDEND' && (
                    <>
                      <Text style={styles.editLabel}>Amount</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editAmount}
                        onChangeText={setEditAmount}
                        placeholder="Amount"
                        keyboardType="decimal-pad"
                      />
                    </>
                  )}
                  <View style={styles.editActions}>
                    <Pressable style={styles.cancelButton} onPress={handleCancelEdit}>
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable style={styles.saveButton} onPress={handleSaveEdit}>
                      <Text style={styles.saveButtonText}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.txnLeft}>
                    <Text style={[styles.txnType, txn.type === 'BUY' ? styles.positive : txn.type === 'SELL' ? styles.negative : styles.dividend]}>{txn.type}</Text>
                    <Text style={styles.txnStock}>{txn.stock}</Text>
                    <Text style={[styles.txnDate, !isValidIsoDate(txn.date || '') && styles.txnDateInvalid]}>
                      {txn.date || '(no date)'}{!isValidIsoDate(txn.date || '') ? ' ⚠' : ''}
                    </Text>
                  </View>
                  <View style={styles.txnRight}>
                    {txn.quantity != null && <Text style={styles.txnDetail}>{txn.quantity.toLocaleString()} sh</Text>}
                    {txn.price != null && <Text style={styles.txnDetail}>@ ₱{txn.price}</Text>}
                    {txn.amount != null && <Text style={styles.txnDetail}>₱{txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>}
                    <View style={styles.txnActions}>
                      <Pressable hitSlop={10} onPress={() => handleEditManual(txn)}>
                        <Ionicons name="create-outline" size={18} color={colors.primary} />
                      </Pressable>
                      <Pressable hitSlop={10} onPress={() => handleDeleteManual(txn.id)}>
                        <Ionicons name="trash-outline" size={18} color={colors.negative} />
                      </Pressable>
                    </View>
                  </View>
                </>
              )}
            </View>
          ))}
        </>
      )}

      <Modal
        visible={showStockPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStockPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Stock</Text>
              <Pressable onPress={() => setShowStockPicker(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search stocks..."
              placeholderTextColor={colors.onSurfaceVariant}
              value={stockSearch}
              onChangeText={setStockSearch}
              autoFocus
            />
            <FlatList
              data={priceCache ? Object.keys(priceCache).filter(t => t.toLowerCase().includes(stockSearch.toLowerCase())).sort() : []}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.stockItem}
                  onPress={() => {
                    setStock(item);
                    setShowStockPicker(false);
                    setStockSearch('');
                  }}
                >
                  <Text style={styles.stockItemText}>{item}</Text>
                </Pressable>
              )}
              style={styles.stockList}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background, ...centeredContent },
  header: { fontFamily: fonts.body, fontSize: 24, color: colors.onBackground, marginBottom: spacing.md },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  chipRow: { marginBottom: spacing.lg, flexGrow: 0 },
  chip: {
    backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginRight: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { fontFamily: fonts.bodySemiBold, color: colors.onSurfaceVariant },
  chipTextSelected: { color: colors.onPrimary },
  button: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center' },
  buttonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
  result: { fontFamily: fonts.bodyMedium, color: colors.positive, marginTop: spacing.md, fontSize: 14, textAlign: 'center' },
  empty: { fontFamily: fonts.body, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 24 },
  divider: { height: 1, backgroundColor: colors.outlineVariant, marginVertical: spacing.lg },
  toggleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  toggleButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary },
  form: { backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.xl, padding: spacing.md, marginTop: spacing.md },
  typeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  typeChip: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingVertical: spacing.sm, alignItems: 'center',
  },
  typeChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onSurfaceVariant },
  typeChipTextSelected: { color: colors.onPrimary },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.sm, fontFamily: fonts.body, fontSize: 15,
  },
  inputText: { fontFamily: fonts.body, fontSize: 15, color: colors.onSurface },
  placeholderText: { color: colors.onSurfaceVariant },
  addButton: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  addButtonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
  sectionHeader: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onBackground, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  fundRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  simulateButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
  },
  simulateButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.primary },
  simulateHint: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginBottom: spacing.sm, lineHeight: 15 },
  fundTabRow: {
    flexDirection: 'row', backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg,
    padding: 4, marginBottom: spacing.md, gap: 4,
  },
  fundTab: { flex: 1, borderRadius: radii.lg - 2, paddingVertical: spacing.sm, alignItems: 'center' },
  fundTabSelected: { backgroundColor: colors.primary },
  fundTabText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSurfaceVariant },
  fundTabTextSelected: { color: colors.onPrimary },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.base,
  },
  txnLeft: { flex: 1 },
  txnType: { fontFamily: fonts.monoBold, fontSize: 11, textTransform: 'uppercase', marginBottom: 2 },
  txnStock: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  txnDate: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  txnDateInvalid: { color: colors.negative, fontFamily: fonts.bodySemiBold },
  txnRight: { alignItems: 'flex-end' },
  txnDetail: { fontFamily: fonts.mono, fontSize: 12, color: colors.onSurfaceVariant },
  txnActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  dividend: { color: colors.primary },
  editForm: { padding: spacing.sm },
  editLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant, marginTop: spacing.sm, marginBottom: 4 },
  editInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface,
    borderRadius: radii.lg, padding: spacing.sm, fontFamily: fonts.body, fontSize: 14, marginBottom: spacing.sm,
  },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cancelButton: { flex: 1, backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.lg, padding: spacing.sm, alignItems: 'center' },
  cancelButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSurfaceVariant },
  saveButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.sm, alignItems: 'center' },
  saveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onPrimary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.md, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.onBackground },
  searchInput: {
    backgroundColor: colors.surfaceContainerHighest, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.md, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface,
  },
  stockList: { flex: 1 },
  stockItem: { paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  stockItemText: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface },
});
