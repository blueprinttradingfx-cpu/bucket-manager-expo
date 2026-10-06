// screens/components/StockTrackerEditorDialog.tsx
// Add/Edit Dialog modal for Stock Tracker entries (T-06c).
// Form fields for all 7 tracker fields + Auto-create Price Alert toggle with auto-linking logic.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, TextInput, ScrollView,
  Switch, StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../core/StoreProvider';
import { useThemeColors } from '../../core/ThemeContext';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { StockTrackerEntry, WeeklyMacdTrend, ForeignFlowSentiment } from '../../core/storeApi';
import { useAuth } from '../../core/AuthProvider';

interface Props {
  visible: boolean;
  initialEntry?: StockTrackerEntry | null;
  onClose: () => void;
  onSaveSuccess: () => void;
}

const MACD_OPTIONS: { key: WeeklyMacdTrend; label: string }[] = [
  { key: 'bullish-converging', label: 'Bullish Conv.' },
  { key: 'bullish-diverging', label: 'Bullish Div.' },
  { key: 'bearish-converging', label: 'Bearish Conv.' },
  { key: 'bearish-diverging', label: 'Bearish Div.' },
  { key: 'sideways', label: 'Sideways' },
  { key: 'none', label: 'None' },
  { key: 'custom', label: 'Custom' },
];

const FF_OPTIONS: { key: ForeignFlowSentiment; label: string }[] = [
  { key: 'strong-buying', label: 'Strong Buy' },
  { key: 'buying', label: 'Buying' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'selling', label: 'Selling' },
  { key: 'strong-selling', label: 'Strong Sell' },
  { key: 'unknown', label: 'Unknown' },
];

export default function StockTrackerEditorDialog({
  visible,
  initialEntry,
  onClose,
  onSaveSuccess,
}: Props) {
  const colors = useThemeColors();
  const store = useStore();
  const { user } = useAuth();
  const styles = createStyles(colors);

  const isEdit = !!initialEntry?.id;

  const [ticker, setTicker] = useState('');
  const [areaPrice, setAreaPrice] = useState('');
  const [macdTrend, setMacdTrend] = useState<WeeklyMacdTrend>('none');
  const [macdCustom, setMacdCustom] = useState('');
  const [ffSentiment, setFfSentiment] = useState<ForeignFlowSentiment>('unknown');
  const [catalyst, setCatalyst] = useState('');
  const [projection, setProjection] = useState('');
  const [notes, setNotes] = useState('');

  // Auto-alert toggle state
  const [autoAlert, setAutoAlert] = useState(true);
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('below');
  const [alertThreshold, setAlertThreshold] = useState('');
  const [alertEmail, setAlertEmail] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // Dirty-form tracking: compare current values against the initial snapshot.
  // We store the baseline at the same time we populate the fields (in the useEffect below).
  const [baseline, setBaseline] = useState<Record<string, string>>({})

  const isDirty = (() => {
    const cur: Record<string, string> = {
      ticker,
      areaPrice,
      macdTrend,
      macdCustom,
      ffSentiment,
      catalyst,
      projection,
      notes,
      alertThreshold,
      alertDirection,
    };
    return Object.keys(cur).some((k) => cur[k] !== (baseline[k] ?? ''));
  })();

  const handleClose = () => {
    if (isDirty && !submitting) {
      Alert.alert(
        'Discard Changes?',
        'You have unsaved changes. Are you sure you want to close without saving?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ]
      );
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const initialTicker = initialEntry?.ticker || '';
    const initialAreaPrice = initialEntry?.areaPriceOfInterest || '';
    const initialMacdTrend: WeeklyMacdTrend = initialEntry?.weeklyMacdTrend || 'none';
    const initialMacdCustom = initialEntry?.weeklyMacdTrendCustom || '';
    const initialFfSentiment: ForeignFlowSentiment = initialEntry?.foreignFlowSentiment || 'unknown';
    const initialCatalyst = initialEntry?.eventCatalyst || '';
    const initialProjection = initialEntry?.projection || '';
    const initialNotes = initialEntry?.notes || '';

    if (initialEntry) {
      setTicker(initialTicker);
      setAreaPrice(initialAreaPrice);
      setMacdTrend(initialMacdTrend);
      setMacdCustom(initialMacdCustom);
      setFfSentiment(initialFfSentiment);
      setCatalyst(initialCatalyst);
      setProjection(initialProjection);
      setNotes(initialNotes);
      setAutoAlert(false); // Default OFF for edit mode unless user re-enables
    } else {
      setTicker('');
      setAreaPrice('');
      setMacdTrend('none');
      setMacdCustom('');
      setFfSentiment('unknown');
      setCatalyst('');
      setProjection('');
      setNotes('');
      setAutoAlert(true);
      setAlertDirection('below');
      setAlertThreshold('');
    }
    setAlertEmail(user?.email || 'user@example.com');

    // Snapshot baseline for dirty-check
    setBaseline({
      ticker: initialTicker,
      areaPrice: initialAreaPrice,
      macdTrend: initialMacdTrend,
      macdCustom: initialMacdCustom,
      ffSentiment: initialFfSentiment,
      catalyst: initialCatalyst,
      projection: initialProjection,
      notes: initialNotes,
      alertThreshold: '',
      alertDirection: 'below',
    });
  }, [initialEntry, visible, user]);

  // Attempt to parse numbers from Area Price of Interest as default threshold
  useEffect(() => {
    if (!initialEntry && areaPrice) {
      const match = areaPrice.match(/(\d+(?:\.\d+)?)/);
      if (match && !alertThreshold) {
        setAlertThreshold(match[1]);
      }
      if (areaPrice.toLowerCase().includes('support') || areaPrice.toLowerCase().includes('buy')) {
        setAlertDirection('below');
      } else if (areaPrice.toLowerCase().includes('target') || areaPrice.toLowerCase().includes('resistance')) {
        setAlertDirection('above');
      }
    }
  }, [areaPrice, initialEntry, alertThreshold]);

  const handleSave = async () => {
    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker) {
      Alert.alert('Validation Error', 'Please enter a valid stock ticker.');
      return;
    }

    setSubmitting(true);
    try {
      let linkedAlertId: string | null = initialEntry?.priceAlertId || null;

      // 1. Create auto-alert if enabled and threshold provided
      if (autoAlert && alertThreshold.trim()) {
        const thresholdNum = parseFloat(alertThreshold.trim());
        if (!isNaN(thresholdNum)) {
          const createdAlert = await store.addStockAlert({
            ticker: cleanTicker,
            type: 'price',
            title: `${cleanTicker} ${alertDirection} ₱${thresholdNum}`,
            eventDate: null,
            eventTime: null,
            reminderTiming: null,
            priceDirection: alertDirection,
            priceThreshold: thresholdNum,
            email: alertEmail.trim() || user?.email || 'user@example.com',
            status: 'active',
            lastTriggeredAt: null,
            lastTriggeredValue: null,
            lastCheckedAt: null,
          });
          linkedAlertId = createdAlert.id;
        }
      }

      // 2. Upsert StockTrackerEntry
      await store.upsertStockTrackerEntry({
        id: initialEntry?.id,
        ticker: cleanTicker,
        areaPriceOfInterest: areaPrice.trim(),
        weeklyMacdTrend: macdTrend,
        weeklyMacdTrendCustom: macdTrend === 'custom' ? macdCustom.trim() : null,
        foreignFlowSentiment: ffSentiment,
        eventCatalyst: catalyst.trim(),
        projection: projection.trim(),
        notes: notes.trim() || null,
        priceAlertId: linkedAlertId,
      });

      onSaveSuccess();
    } catch (e: any) {
      console.error('[StockTrackerEditorDialog] Save failed:', e);
      Alert.alert('Error', e?.message || 'Failed to save tracker entry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.dialogCard}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{isEdit ? `Edit Tracker (${ticker})` : 'Add Tracked Stock'}</Text>
            <Pressable onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {/* Ticker Input */}
            <Text style={styles.label}>Stock Ticker *</Text>
            <TextInput
              style={[styles.input, isEdit && styles.disabledInput]}
              value={ticker}
              onChangeText={setTicker}
              placeholder="e.g. ALI, SM, MER"
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="characters"
              editable={!isEdit}
            />

            {/* Area Price of Interest */}
            <Text style={styles.label}>Area Price of Interest</Text>
            <TextInput
              style={styles.input}
              value={areaPrice}
              onChangeText={setAreaPrice}
              placeholder="e.g. Buy zone ₱28.50 - ₱30.00"
              placeholderTextColor={colors.onSurfaceVariant}
            />

            {/* Weekly MACD Trend Select */}
            <Text style={styles.label}>Weekly MACD Trend</Text>
            <View style={styles.optionsWrap}>
              {MACD_OPTIONS.map((opt) => {
                const active = macdTrend === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[styles.optChip, active && styles.optChipActive]}
                    onPress={() => setMacdTrend(opt.key)}
                  >
                    <Text style={[styles.optChipText, active && styles.optChipTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {macdTrend === 'custom' && (
              <TextInput
                style={[styles.input, { marginTop: spacing.xs }]}
                value={macdCustom}
                onChangeText={setMacdCustom}
                placeholder="Custom MACD trend note..."
                placeholderTextColor={colors.onSurfaceVariant}
              />
            )}

            {/* Foreign Flow Sentiment Select */}
            <Text style={styles.label}>Foreign Flow Sentiment</Text>
            <View style={styles.optionsWrap}>
              {FF_OPTIONS.map((opt) => {
                const active = ffSentiment === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[styles.optChip, active && styles.optChipActive]}
                    onPress={() => setFfSentiment(opt.key)}
                  >
                    <Text style={[styles.optChipText, active && styles.optChipTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Event Catalyst */}
            <Text style={styles.label}>Event Catalyst</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={catalyst}
              onChangeText={setCatalyst}
              placeholder="e.g. Q3 Earnings beat, Dividend announcement"
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
            />

            {/* Projection */}
            <Text style={styles.label}>Projection / Thesis</Text>
            <TextInput
              style={styles.input}
              value={projection}
              onChangeText={setProjection}
              placeholder="e.g. 3-mo target ₱35.00"
              placeholderTextColor={colors.onSurfaceVariant}
            />

            {/* Notes */}
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Long form analysis or notes..."
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
            />

            {/* Auto-create Price Alert Toggle */}
            <View style={styles.alertBox}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>Auto-create Price Alert</Text>
                  <Text style={styles.alertSubtitle}>Creates a linked price alert automatically</Text>
                </View>
                <Switch
                  value={autoAlert}
                  onValueChange={setAutoAlert}
                  trackColor={{ false: colors.outlineVariant, true: colors.primary + '80' }}
                  thumbColor={autoAlert ? colors.primary : colors.surfaceContainerHighest}
                />
              </View>

              {autoAlert && (
                <View style={styles.alertForm}>
                  <View style={styles.directionRow}>
                    <Pressable
                      style={[styles.dirBtn, alertDirection === 'below' && styles.dirBtnActive]}
                      onPress={() => setAlertDirection('below')}
                    >
                      <Ionicons name="arrow-down-outline" size={14} color={alertDirection === 'below' ? colors.onPrimary : colors.onSurface} />
                      <Text style={[styles.dirBtnText, alertDirection === 'below' && styles.dirBtnTextActive]}>Drops Below</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.dirBtn, alertDirection === 'above' && styles.dirBtnActive]}
                      onPress={() => setAlertDirection('above')}
                    >
                      <Ionicons name="arrow-up-outline" size={14} color={alertDirection === 'above' ? colors.onPrimary : colors.onSurface} />
                      <Text style={[styles.dirBtnText, alertDirection === 'above' && styles.dirBtnTextActive]}>Rises Above</Text>
                    </Pressable>
                  </View>

                  <Text style={[styles.label, { marginTop: spacing.xs }]}>Target Price Threshold (₱)</Text>
                  <TextInput
                    style={styles.input}
                    value={alertThreshold}
                    onChangeText={setAlertThreshold}
                    placeholder="e.g. 28.50"
                    placeholderTextColor={colors.onSurfaceVariant}
                    keyboardType="numeric"
                  />
                </View>
              )}
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={handleClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={handleSave} disabled={submitting}>
              <Text style={styles.saveBtnText}>{submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Stock'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: spacing.md,
    },
    dialogCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      maxHeight: '90%',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerHigh,
    },
    title: {
      fontFamily: fonts.bodyBold,
      fontSize: 18,
      color: colors.onSurface,
    },
    body: {
      padding: spacing.md,
    },
    label: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: spacing.sm,
      marginBottom: 4,
    },
    input: {
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.onSurface,
    },
    disabledInput: {
      opacity: 0.6,
      backgroundColor: colors.surfaceContainerHighest,
    },
    multilineInput: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    optionsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: spacing.xs,
    },
    optChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.default,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    optChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    optChipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    optChipTextActive: {
      color: colors.onPrimary,
    },
    alertBox: {
      marginTop: spacing.md,
      padding: spacing.sm,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    alertTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.onSurface,
    },
    alertSubtitle: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.onSurfaceVariant,
    },
    alertForm: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
    directionRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    dirBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      borderRadius: radii.default,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerHigh,
    },
    dirBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dirBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.onSurface,
      marginLeft: 4,
    },
    dirBtnTextActive: {
      color: colors.onPrimary,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerHigh,
      gap: spacing.sm,
    },
    cancelBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    cancelBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 14,
      color: colors.onSurfaceVariant,
    },
    saveBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
    },
    saveBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onPrimary,
    },
  });
}
