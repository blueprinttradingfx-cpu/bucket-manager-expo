// screens/components/TagEditorDialog.tsx
// Dialog for editing tags assigned to a stock ticker. Shows existing assigned tags
// as removable chips, existing tags in the app as quick-add chips, and a text input
// to create custom tags. Max 10 tags per ticker.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

interface Props {
  visible: boolean;
  ticker: string;
  initialTags: string[];
  allAppTags: { tag: string; tickerCount: number }[];
  onClose: () => void;
  onSaveTags: (tags: string[]) => Promise<void>;
}

export default function TagEditorDialog({
  visible,
  ticker,
  initialTags,
  allAppTags,
  onClose,
  onSaveTags,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [newTagText, setNewTagText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTags(initialTags);
      setNewTagText('');
      setError(null);
      setSaving(false);
    }
  }, [visible, initialTags]);

  const availableAppTags = useMemo(() => {
    const currentSet = new Set(tags.map((t) => t.toLowerCase()));
    return allAppTags.filter((item) => !currentSet.has(item.tag.toLowerCase()));
  }, [allAppTags, tags]);

  function normalizeTag(input: string): string {
    let t = input.trim();
    if (!t) return '';
    if (!t.startsWith('#')) {
      t = `#${t}`;
    }
    return t;
  }

  function handleAddTag(tagCandidate: string) {
    const norm = normalizeTag(tagCandidate);
    if (!norm) return;
    if (tags.length >= 10) {
      setError('Maximum 10 tags per stock.');
      return;
    }
    if (tags.some((t) => t.toLowerCase() === norm.toLowerCase())) {
      setError('Tag already added.');
      return;
    }
    setTags((prev) => [...prev, norm]);
    setNewTagText('');
    setError(null);
  }

  function handleRemoveTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSaveTags(tags);
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save tags.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.header}>
            <Text style={styles.title}>Edit Tags for {ticker}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>Current Tags ({tags.length}/10)</Text>
            {tags.length === 0 ? (
              <Text style={styles.emptyHint}>No tags assigned yet.</Text>
            ) : (
              <View style={styles.chipRow}>
                {tags.map((tag) => (
                  <View key={tag} style={styles.assignedChip}>
                    <Text style={styles.assignedChipText}>{tag}</Text>
                    <Pressable
                      style={styles.chipRemoveBtn}
                      onPress={() => handleRemoveTag(tag)}
                      hitSlop={6}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.onPrimary} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {availableAppTags.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Existing Tags in App</Text>
                <View style={styles.chipRow}>
                  {availableAppTags.map((item) => (
                    <Pressable
                      key={item.tag}
                      style={styles.suggestionChip}
                      onPress={() => handleAddTag(item.tag)}
                    >
                      <Ionicons name="add" size={14} color={colors.primary} />
                      <Text style={styles.suggestionChipText}>{item.tag}</Text>
                      <Text style={styles.suggestionCount}>({item.tickerCount})</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Add Custom Tag</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={newTagText}
                onChangeText={(t) => {
                  setNewTagText(t);
                  setError(null);
                }}
                placeholder="e.g. #recession-proof"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => handleAddTag(newTagText)}
              />
              <Pressable
                style={[styles.addBtn, (!newTagText.trim() || tags.length >= 10) && styles.btnDisabled]}
                onPress={() => handleAddTag(newTagText)}
                disabled={!newTagText.trim() || tags.length >= 10}
              >
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Tags'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
    },
    dialog: {
      width: '100%',
      maxWidth: 440,
      maxHeight: '80%',
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    title: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: colors.onSurface,
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      padding: spacing.lg,
    },
    sectionLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      marginBottom: spacing.xs,
    },
    emptyHint: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      fontStyle: 'italic',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    assignedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: radii.full,
      paddingVertical: 4,
      paddingLeft: spacing.sm,
      paddingRight: 6,
      gap: 4,
    },
    assignedChipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: colors.onPrimary,
    },
    chipRemoveBtn: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    suggestionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: radii.full,
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
      gap: 4,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    suggestionChipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: colors.onSurface,
    },
    suggestionCount: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.onSurfaceVariant,
    },
    inputRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: 4,
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
    addBtn: {
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      alignItems: 'center',
    },
    btnDisabled: {
      opacity: 0.5,
    },
    addBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.onPrimary,
    },
    errorText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.negative,
      marginTop: spacing.xs,
    },
    footer: {
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
