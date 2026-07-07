// screens/components/PassiveIncomeGoalCard.tsx
// The "Passive Income Goal" circular gauge card shown on the main Dashboard,
// above Yield Distribution - inspired by the reference design (circular %
// gauge, "XX / Goal" readout, "Set Goal ->" opening a popup to edit the
// target). Uses react-native-svg for the ring itself since a precise
// rounded-stroke arc isn't achievable with plain Views - everything else
// (the card chrome, the "Set Goal" modal) is plain RN primitives, same as
// the rest of the app.
//
// Tracks the CURRENT calendar month's declared dividend income against the
// goal, not a rolling average - it resets every month, same as how a
// "monthly passive income goal" is usually meant (hit ₱1,000 THIS month),
// rather than smoothing over a slow month with a fast one.

import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, spacing, radii, fonts } from '../../core/theme';

const GAUGE_SIZE = 100;
const STROKE_WIDTH = 10;

function CircularGauge({ percent }: { percent: number }) {
  const radius = (GAUGE_SIZE - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(percent, 100));
  const strokeDashoffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}>
      <Svg width={GAUGE_SIZE} height={GAUGE_SIZE}>
        <Circle
          cx={GAUGE_SIZE / 2} cy={GAUGE_SIZE / 2} r={radius}
          stroke={colors.surfaceContainerHighest} strokeWidth={STROKE_WIDTH} fill="none"
        />
        <Circle
          cx={GAUGE_SIZE / 2} cy={GAUGE_SIZE / 2} r={radius}
          stroke={colors.positive} strokeWidth={STROKE_WIDTH} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          originX={GAUGE_SIZE / 2}
          originY={GAUGE_SIZE / 2}
        />
      </Svg>
      <View style={styles.gaugeCenter} pointerEvents="none">
        <Text style={styles.gaugePercent}>{Math.round(clamped)}%</Text>
      </View>
    </View>
  );
}

export default function PassiveIncomeGoalCard({
  currentMonthIncome, goal, onSaveGoal,
}: {
  currentMonthIncome: number;
  goal: number | null;
  onSaveGoal: (goal: number) => Promise<void> | void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draftGoal, setDraftGoal] = useState(goal != null ? String(goal) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const percent = goal && goal > 0 ? (currentMonthIncome / goal) * 100 : 0;

  function openModal() {
    setDraftGoal(goal != null ? String(goal) : '');
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    const parsed = Number(draftGoal.replace(/,/g, ''));
    if (!draftGoal.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a goal amount greater than 0.');
      return;
    }
    setSaving(true);
    try {
      await onSaveGoal(parsed);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Passive Income Goal, ₱</Text>
      <View style={styles.row}>
        <CircularGauge percent={percent} />
        <View style={styles.readout}>
          <Text style={styles.readoutValue}>
            {currentMonthIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {' / '}
            {goal != null ? goal.toLocaleString(undefined, { minimumFractionDigits: 0 }) : '—'}
          </Text>
          <Text style={styles.readoutCaption}>this month</Text>
        </View>
      </View>
      <Pressable onPress={openModal} hitSlop={8} style={styles.setGoalRow}>
        <Text style={styles.setGoalText}>{goal != null ? 'Set Goal' : 'Set a Goal'} →</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Monthly Passive Income Goal</Text>
            <Text style={styles.modalSubtitle}>How much dividend income would you like to receive each month?</Text>
            <TextInput
              style={[styles.input, error && styles.inputError]}
              value={draftGoal}
              onChangeText={(t) => { setDraftGoal(t); setError(null); }}
              placeholder="e.g. 1000"
              placeholderTextColor={colors.onSurfaceVariant}
              keyboardType="decimal-pad"
              autoFocus
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelButton} onPress={() => setModalOpen(false)} disabled={saving}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gaugeCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  gaugePercent: { fontFamily: fonts.monoBold, fontSize: 18, color: colors.onSurface },
  readout: { flex: 1 },
  readoutValue: { fontFamily: fonts.monoBold, fontSize: 20, color: colors.onSurface },
  readoutCaption: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 },
  setGoalRow: { alignSelf: 'flex-end', marginTop: spacing.sm },
  setGoalText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalContent: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md },
  modalTitle: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.onBackground, marginBottom: 4 },
  modalSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  input: {
    fontFamily: fonts.mono, fontSize: 16, color: colors.onSurface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  inputError: { borderColor: colors.negative },
  errorText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative, marginTop: 4 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  cancelButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
  cancelButtonText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceVariant },
  saveButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
  saveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onPrimary },
});
