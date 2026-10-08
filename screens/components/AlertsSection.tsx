// screens/components/AlertsSection.tsx
// Alerts card on StockDetailScreen. Renders a list of StockAlerts for one
// ticker and exposes inline Add / Edit / Delete / Pause-Resume controls.
//
// Presentational: store calls (addStockAlert, updateStockAlert,
// deleteStockAlert) live in StockDetailScreen. This component owns only the
// dialog open/close state and calls back up through onAdd / onUpdate /
// onDelete. Error handling (Alert.alert) is also the caller's responsibility.

import React, { useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StockAlert } from '../../core/storeApi';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { useAuth } from '../../core/AuthProvider';

interface Props {
  alerts: StockAlert[];
  loading: boolean;
  ticker: string;
  onAdd: (alert: Omit<StockAlert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => Promise<void>;
  onUpdate: (id: string, updates: Partial<Pick<StockAlert, 'title' | 'eventDate' | 'eventTime' | 'reminderTiming' | 'priceDirection' | 'priceThreshold' | 'email' | 'status'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** T-07: IDs of alerts that were auto-created by a Stock Tracker entry. */
  linkedAlertIds?: Set<string>;
  /** T-07: Called when user taps the "Jump to Tracker" chip on a linked alert row. */
  onNavigateToTracker?: () => void;
}

type AlertType = 'event' | 'price';
type ReminderTiming = 'day-before' | 'day-of' | 'both';
type PriceDirection = 'above' | 'below';

interface AlertFormState {
  type: AlertType;
  title: string;
  eventDate: string;
  eventTime: string;
  reminderTiming: ReminderTiming;
  priceDirection: PriceDirection;
  priceThreshold: string;
  email: string;
}

function freshForm(defaultEmail = ''): AlertFormState {
  return {
    type: 'event',
    title: '',
    eventDate: '',
    eventTime: '',
    reminderTiming: 'day-before',
    priceDirection: 'below',
    priceThreshold: '',
    email: defaultEmail,
  };
}

function formFromAlert(a: StockAlert): AlertFormState {
  return {
    type: a.type,
    title: a.title,
    eventDate: a.eventDate ?? '',
    eventTime: a.eventTime ?? '',
    reminderTiming: (a.reminderTiming as ReminderTiming) ?? 'day-before',
    priceDirection: (a.priceDirection as PriceDirection) ?? 'below',
    priceThreshold: a.priceThreshold != null ? String(a.priceThreshold) : '',
    email: a.email,
  };
}

function validateForm(form: AlertFormState): string | null {
  if (!form.title.trim()) return 'Title is required.';
  if (form.type === 'event') {
    if (!form.eventDate.trim()) return 'Event date is required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.eventDate.trim())) return 'Date must be YYYY-MM-DD.';
  }
  if (form.type === 'price') {
    const n = parseFloat(form.priceThreshold);
    if (!form.priceThreshold.trim() || Number.isNaN(n) || n <= 0)
      return 'Price threshold must be a positive number.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// AlertDialog
// ---------------------------------------------------------------------------
function AlertDialog({
  visible, ticker, initialForm, editingId, onClose, onSave,
}: {
  visible: boolean;
  ticker: string;
  initialForm: AlertFormState;
  editingId: string | null;
  onClose: () => void;
  onSave: (form: AlertFormState) => Promise<void>;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [form, setForm] = useState<AlertFormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setForm(initialForm);
      setError(null);
      setSaving(false);
    }
  }, [visible, initialForm]);

  function set<K extends keyof AlertFormState>(key: K, value: AlertFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function handleSave() {
    const err = validateForm(form);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save alert.');
    } finally {
      setSaving(false);
    }
  }

  const isEvent = form.type === 'event';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.dialogHeader}>
            <Text style={styles.dialogTitle}>
              {editingId ? 'Edit Alert' : 'New Alert'} · {ticker}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.dialogBody}
            contentContainerStyle={styles.dialogBodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Type */}
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.segmentRow}>
              {(['event', 'price'] as AlertType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.segment, form.type === t && styles.segmentActive]}
                  onPress={() => set('type', t)}
                >
                  <Text style={[styles.segmentText, form.type === t && styles.segmentTextActive]}>
                    {t === 'event' ? '📅  Event' : '📈  Price'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Title */}
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(v) => set('title', v)}
              placeholder={isEvent ? 'e.g. AGM, Ex-Dividend Date' : 'e.g. ALRT drops below ₱1.50'}
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="sentences"
            />

            {isEvent ? (
              <>
                <Text style={styles.fieldLabel}>Event Date</Text>
                <TextInput
                  style={styles.input}
                  value={form.eventDate}
                  onChangeText={(v) => set('eventDate', v)}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.onSurfaceVariant}
                />
                <Text style={styles.fieldLabel}>Event Time (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={form.eventTime}
                  onChangeText={(v) => set('eventTime', v)}
                  placeholder="e.g. 09:00"
                  placeholderTextColor={colors.onSurfaceVariant}
                />
                <Text style={styles.fieldLabel}>Reminder Timing</Text>
                <View style={styles.segmentRow}>
                  {([
                    ['day-before', 'Day Before'],
                    ['day-of', 'Day Of'],
                    ['both', 'Both'],
                  ] as [ReminderTiming, string][]).map(([val, label]) => (
                    <Pressable
                      key={val}
                      style={[styles.segment, form.reminderTiming === val && styles.segmentActive]}
                      onPress={() => set('reminderTiming', val)}
                    >
                      <Text style={[styles.segmentText, form.reminderTiming === val && styles.segmentTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Direction</Text>
                <View style={styles.segmentRow}>
                  {([
                    ['below', '↓ Below'],
                    ['above', '↑ Above'],
                  ] as [PriceDirection, string][]).map(([val, label]) => (
                    <Pressable
                      key={val}
                      style={[styles.segment, form.priceDirection === val && styles.segmentActive]}
                      onPress={() => set('priceDirection', val)}
                    >
                      <Text style={[styles.segmentText, form.priceDirection === val && styles.segmentTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Price Threshold (₱)</Text>
                <TextInput
                  style={styles.input}
                  value={form.priceThreshold}
                  onChangeText={(v) => set('priceThreshold', v)}
                  placeholder="e.g. 1.50"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Email for Notifications</Text>
            <TextInput
              style={styles.input}
              value={form.email}
              onChangeText={(v) => set('email', v)}
              placeholder="your@email.com"
              placeholderTextColor={colors.onSurfaceVariant}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {error != null && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          <View style={styles.dialogFooter}>
            <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Alert'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AlertRow
// ---------------------------------------------------------------------------
function AlertRow({
  alert, onEdit, onDelete, onTogglePause, isLinkedFromTracker, onNavigateToTracker,
}: {
  alert: StockAlert;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePause: () => void;
  /** T-07: true if this alert was auto-created by a Stock Tracker entry. */
  isLinkedFromTracker?: boolean;
  /** T-07: navigate back to the tracker screen. */
  onNavigateToTracker?: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isPaused = alert.status === 'paused';

  const subtitle =
    alert.type === 'event'
      ? [alert.eventDate, alert.eventTime].filter(Boolean).join(' · ')
      : alert.priceDirection != null && alert.priceThreshold != null
        ? `${alert.priceDirection === 'above' ? '↑ Above' : '↓ Below'} ₱${alert.priceThreshold}`
        : '';

  const reminderLabel: Record<string, string> = {
    'day-before': 'Remind day before',
    'day-of': 'Remind day of',
    both: 'Remind day before & day of',
  };

  return (
    <View style={[styles.alertRow, isPaused && styles.alertRowPaused]}>
      <View style={styles.alertIconWrap}>
        <Ionicons
          name={alert.type === 'event' ? 'calendar-outline' : 'trending-up-outline'}
          size={18}
          color={isPaused ? colors.onSurfaceVariant : colors.primary}
        />
      </View>
      <View style={styles.alertContent}>
        <Text style={[styles.alertTitle, isPaused && styles.alertTitlePaused]} numberOfLines={2}>
          {alert.title}
        </Text>
        {!!subtitle && <Text style={styles.alertMeta}>{subtitle}</Text>}
        {alert.type === 'event' && alert.reminderTiming != null && (
          <Text style={styles.alertMeta}>{reminderLabel[alert.reminderTiming] ?? alert.reminderTiming}</Text>
        )}
        {!!alert.email && <Text style={styles.alertMeta}>📧 {alert.email}</Text>}
        {isPaused && <Text style={styles.alertPausedBadge}>Paused</Text>}
        {/* T-07: chip shown on alerts linked from the Stock Tracker */}
        {isLinkedFromTracker && (
          <Pressable
            style={styles.trackerLinkChip}
            onPress={onNavigateToTracker}
            hitSlop={6}
          >
            <Ionicons name="stats-chart-outline" size={11} color={colors.primary} style={{ marginRight: 3 }} />
            <Text style={styles.trackerLinkChipText}>Linked from Stock Tracker  →</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.alertActions}>
        <Pressable onPress={onTogglePause} hitSlop={8} style={styles.actionBtn}>
          <Ionicons
            name={isPaused ? 'play-outline' : 'pause-outline'}
            size={16}
            color={colors.onSurfaceVariant}
          />
        </Pressable>
        <Pressable onPress={onEdit} hitSlop={8} style={styles.actionBtn}>
          <Ionicons name="pencil-outline" size={16} color={colors.onSurfaceVariant} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.actionBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.negative} />
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AlertsSection (exported)
// ---------------------------------------------------------------------------
export default function AlertsSection({
  alerts, loading, ticker, onAdd, onUpdate, onDelete, linkedAlertIds, onNavigateToTracker,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingAlert, setEditingAlert] = useState<StockAlert | null>(null);

  // Memoised so the form ref is stable when the dialog is closed (avoids a
  // stale-closure flash when animationType="fade" still renders for a frame).
  // Email for Notifications defaults to the signed-in user's email (editable).
  const { user } = useAuth();
  const defaultEmail = user?.email ?? '';
  const addInitialForm = useMemo(() => freshForm(defaultEmail), [ticker, defaultEmail]);
  const editInitialForm = useMemo(
    () => (editingAlert ? formFromAlert(editingAlert) : freshForm(defaultEmail)),
    [editingAlert, defaultEmail]
  );

  async function handleAdd(form: AlertFormState) {
    await onAdd({
      ticker,
      type: form.type,
      title: form.title.trim(),
      eventDate: form.type === 'event' ? (form.eventDate.trim() || null) : null,
      eventTime: form.type === 'event' ? (form.eventTime.trim() || null) : null,
      reminderTiming: form.type === 'event' ? form.reminderTiming : null,
      priceDirection: form.type === 'price' ? form.priceDirection : null,
      priceThreshold: form.type === 'price' ? parseFloat(form.priceThreshold) : null,
      email: form.email.trim(),
      status: 'active',
      lastTriggeredAt: null,
      lastTriggeredValue: null,
      lastCheckedAt: null,
    });
  }

  async function handleEdit(form: AlertFormState) {
    if (!editingAlert) return;
    await onUpdate(editingAlert.id, {
      title: form.title.trim(),
      eventDate: form.type === 'event' ? (form.eventDate.trim() || null) : null,
      eventTime: form.type === 'event' ? (form.eventTime.trim() || null) : null,
      reminderTiming: form.type === 'event' ? form.reminderTiming : null,
      priceDirection: form.type === 'price' ? form.priceDirection : null,
      priceThreshold: form.type === 'price' ? parseFloat(form.priceThreshold) : null,
      email: form.email.trim(),
    });
  }

  function handleTogglePause(a: StockAlert) {
    // Fire-and-forget; caller will surface any error via Alert.alert.
    onUpdate(a.id, { status: a.status === 'active' ? 'paused' : 'active' });
  }

  return (
    <View>
      {/* Header row */}
      <View style={styles.header}>
        <Ionicons name="notifications-outline" size={16} color={colors.primary} />
        <Text style={styles.headerTitle}>Alerts</Text>
        <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={styles.addBtnText}>Add Alert</Text>
        </Pressable>
      </View>

      {/* Body */}
      {loading ? (
        <Text style={styles.emptyText}>Loading…</Text>
      ) : alerts.length === 0 ? (
        <Text style={styles.emptyText}>
          No alerts set. Tap "Add Alert" to get notified about events or price moves.
        </Text>
      ) : (
        alerts.map((a) => (
          <AlertRow
            key={a.id}
            alert={a}
            onEdit={() => setEditingAlert(a)}
            onDelete={() => onDelete(a.id)}
            onTogglePause={() => handleTogglePause(a)}
            isLinkedFromTracker={linkedAlertIds?.has(a.id) ?? false}
            onNavigateToTracker={onNavigateToTracker}
          />
        ))
      )}

      {/* Add dialog */}
      <AlertDialog
        visible={showAdd}
        ticker={ticker}
        initialForm={addInitialForm}
        editingId={null}
        onClose={() => setShowAdd(false)}
        onSave={handleAdd}
      />

      {/* Edit dialog */}
      <AlertDialog
        visible={editingAlert != null}
        ticker={ticker}
        initialForm={editInitialForm}
        editingId={editingAlert?.id ?? null}
        onClose={() => setEditingAlert(null)}
        onSave={handleEdit}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    headerTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onSurface,
      flex: 1,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    addBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.primary,
    },
    emptyText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      fontStyle: 'italic',
      paddingVertical: spacing.sm,
    },
    // Alert rows
    alertRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outline,
    },
    alertRowPaused: {
      opacity: 0.55,
    },
    alertIconWrap: {
      width: 32,
      height: 32,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      marginTop: 2,
    },
    alertContent: {
      flex: 1,
      gap: 2,
    },
    alertTitle: {
      fontFamily: fonts.bodyMedium,
      fontSize: 14,
      color: colors.onSurface,
    },
    alertTitlePaused: {
      color: colors.onSurfaceVariant,
    },
    alertMeta: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    alertPausedBadge: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: colors.onSurfaceVariant,
      fontStyle: 'italic',
    },
    // T-07: chip on alert rows linked from the Stock Tracker
    trackerLinkChip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginTop: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radii.default,
      backgroundColor: colors.primaryContainer,
      borderWidth: 1,
      borderColor: colors.primary + '40',
    },
    trackerLinkChipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 10,
      color: colors.primary,
    },
    alertActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionBtn: {
      padding: spacing.xs,
    },
    // Dialog
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.52)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
    },
    dialog: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '90%' as any,
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    dialogHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    dialogTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: colors.onSurface,
      flex: 1,
    },
    dialogBody: {
      flex: 1,
    },
    dialogBodyContent: {
      padding: spacing.lg,
    },
    fieldLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceVariant,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.onSurface,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    segmentRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      flexWrap: 'wrap',
    },
    segment: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceVariant,
    },
    segmentActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    segmentText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: colors.onSurfaceVariant,
    },
    segmentTextActive: {
      color: colors.onPrimary,
    },
    errorText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.negative,
      marginTop: spacing.xs,
    },
    dialogFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
    cancelBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
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
