// screens/AllNotesScreen.tsx
// Global note feed: every StockNote the user ever wrote, merged across all
// tickers, newest first. Settings → My Data → All Notes entry pushes this
// screen on top of SettingsStack (see App.tsx SettingsStackNavigator).
//
// T-02b: the inline edit composer now uses the shared NoteComposerToolbar +
// InsertImageUrlModal (one modal mounted at screen level, shared between
// whichever AllNoteCard is currently editing). Image insert follows the
// same "img snippet → current selection" pattern as StockNotesSection.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Alert from '../core/alert';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { SettingsStackParamList } from '../core/navigationTypes';
import { useStore } from '../core/StoreProvider';
import { StockNote } from '../core/storeApi';
import { useScreenViewLog } from '../core/useScreenViewLog';
import SimpleHtml from './components/SimpleHtml';
import NoteComposerToolbar from './components/NoteComposerToolbar';
import InsertImageUrlModal from './components/InsertImageUrlModal';

type Props = NativeStackScreenProps<SettingsStackParamList, 'AllNotes'>;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function Composer({
  initialValue, submitLabel, onCancel, onSubmit,
  onOpenImage, imageInsertedText, onAfterImageInserted,
}: {
  initialValue: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (html: string) => Promise<void>;
  onOpenImage: () => void;
  imageInsertedText: string | null;
  onAfterImageInserted: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const inputRef = useRef<any>(null);

  const trimmed = draft.trim();

  React.useEffect(() => {
    if (imageInsertedText == null) return;
    try {
      let start = Number(selection?.start);
      let end = Number(selection?.end);
      if (!Number.isFinite(start) || start < 0) start = draft.length;
      if (!Number.isFinite(end) || end < start) end = start;
      if (end > draft.length) end = draft.length;
      if (start > draft.length) start = draft.length;
      const next = draft.slice(0, start) + imageInsertedText + draft.slice(end);
      const pos = start + imageInsertedText.length;
      setDraft(next);
      setSelection({ start: pos, end: pos });
      try { inputRef.current?.setNativeProps?.({ selection: { start: pos, end: pos } }); } catch { /* ignore */ }
    } catch {
      setDraft((prev) => prev + imageInsertedText);
    }
    onAfterImageInserted();
  }, [imageInsertedText]);

  async function handleSubmit() {
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.composer}>
      <NoteComposerToolbar
        value={draft}
        selection={selection}
        onChangeText={setDraft}
        onAfterInsert={(pos) => {
          setSelection({ start: pos, end: pos });
          try { inputRef.current?.setNativeProps?.({ selection: { start: pos, end: pos } }); } catch { /* ignore */ }
        }}
        onImagePressed={onOpenImage}
      />
      <TextInput
        ref={inputRef}
        style={styles.composerInput}
        value={draft}
        onChangeText={setDraft}
        onSelectionChange={(e) => {
          try { setSelection(e.nativeEvent.selection); } catch { /* ignore */ }
        }}
        selection={selection}
        placeholder="Write a note..."
        placeholderTextColor={colors.onSurfaceVariant}
        multiline
        textAlignVertical="top"
      />
      {trimmed.length > 0 && (
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>Preview</Text>
          <SimpleHtml html={trimmed} />
        </View>
      )}
      <View style={styles.composerActions}>
        <Pressable onPress={onCancel} disabled={saving} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.saveButton, (!trimmed || saving) && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={!trimmed || saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AllNoteCard({
  note,
  onUpdate,
  onDelete,
  onOpenTicker,
  isEditing,
  setEditing,
  onOpenImage,
  pendingImage,
  onAfterImageInserted,
}: {
  note: StockNote;
  onUpdate: (id: string, html: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenTicker: (ticker: string) => void;
  isEditing: boolean;
  setEditing: (v: boolean) => void;
  onOpenImage: () => void;
  pendingImage: string | null;
  onAfterImageInserted: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [deleting, setDeleting] = useState(false);

  function confirmDelete() {
    Alert.alert('Delete Note', "Are you sure you want to delete this note? This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await onDelete(note.id);
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (isEditing) {
    return (
      <View style={styles.card}>
        <Composer
          initialValue={note.contentHtml}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (html) => {
            await onUpdate(note.id, html);
            setEditing(false);
          }}
          onOpenImage={onOpenImage}
          imageInsertedText={pendingImage}
          onAfterImageInserted={onAfterImageInserted}
        />
      </View>
    );
  }

  return (
    <Pressable onPress={() => onOpenTicker(note.ticker)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardHeader}>
        <View style={styles.tickerBadge}>
          <Text style={styles.tickerText}>{note.ticker}</Text>
        </View>
        <Text style={styles.timestamp}>{formatTimestamp(note.createdAt)}</Text>
        <View style={styles.cardActions}>
          <Pressable onPress={(e) => { e.stopPropagation(); setEditing(true); }} hitSlop={8} disabled={deleting}>
            <Ionicons name="pencil-outline" size={15} color={colors.onSurfaceVariant} />
          </Pressable>
          <Pressable onPress={(e) => { e.stopPropagation(); confirmDelete(); }} hitSlop={8} disabled={deleting}>
            <Ionicons name="trash-outline" size={15} color={deleting ? colors.onSurfaceVariant : colors.negative} />
          </Pressable>
        </View>
      </View>
      <View style={styles.cardPreview}>
        <SimpleHtml html={note.contentHtml} />
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.footerHint}>Tap to open {note.ticker} details</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceVariant} />
      </View>
    </Pressable>
  );
}

export default function AllNotesScreen({ route }: Props) {
  useScreenViewLog('AllNotes');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const store = useStore();
  const navigation = useNavigation();

  const initialTicker = route.params?.tickerFilter;

  const [notes, setNotes] = useState<StockNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(initialTicker ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [pendingEditImg, setPendingEditImg] = useState<{ id: string; snippet: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await store.listAllStockNotes(selectedTicker ?? undefined);
      setNotes(list);
    } catch (err) {
      console.error('[AllNotesScreen] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [store, selectedTicker]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => { cancelled = true; };
    }, [load])
  );

  const tickers = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) set.add(n.ticker);
    return Array.from(set).sort();
  }, [notes]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUpdate(id: string, html: string) {
    try {
      await store.updateStockNote(id, html);
    } catch (err) {
      Alert.alert('Failed to update note', err instanceof Error ? err.message : 'Unknown error');
      return;
    }
    await load();
  }

  async function handleDelete(id: string) {
    try {
      await store.deleteStockNote(id);
    } catch (err) {
      Alert.alert('Failed to delete note', err instanceof Error ? err.message : 'Unknown error');
      return;
    }
    await load();
  }

  function handleOpenTicker(ticker: string) {
    // AllNotesScreen is in SettingsStack. Cross-tab jump to Dashboard
    // where StockDetail is registered. Pattern matches App.tsx
    // handleTabNavigate (navigate with screen + params inside tab key).
    const navAny = navigation as any;
    try {
      navAny.navigate('Dashboard', { screen: 'StockDetail', params: { ticker } });
    } catch (err) {
      console.error('[AllNotesScreen] navigate to StockDetail failed:', err);
    }
  }

  function handleImageInsertFromModal(snippet: string) {
    if (editingId) setPendingEditImg({ id: editingId, snippet });
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.header}>All Notes</Text>
        <Text style={styles.subheader}>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</Text>
      </View>

      {(tickers.length > 1 || (tickers.length === 1 && !selectedTicker)) ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable
            style={[styles.chip, selectedTicker === null && styles.chipActive]}
            onPress={() => setSelectedTicker(null)}
          >
            <Text style={[styles.chipLabel, selectedTicker === null && styles.chipLabelActive]}>All</Text>
          </Pressable>
          {tickers.map((t) => (
            <Pressable
              key={t}
              style={[styles.chip, selectedTicker === t && styles.chipActive]}
              onPress={() => setSelectedTicker(t)}
            >
              <Text style={[styles.chipLabel, selectedTicker === t && styles.chipLabelActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {loading ? (
        <Text style={styles.empty}>Loading notes...</Text>
      ) : notes.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={40} color={colors.onSurfaceVariant} style={{ marginBottom: spacing.md }} />
          <Text style={styles.emptyStateTitle}>You have 0 notes yet</Text>
          <Text style={styles.emptyStateHint}>
            Open any stock's detail screen and tap Add Note to log your thoughts.
          </Text>
        </View>
      ) : (
        <View style={styles.feed}>
          {notes.map((note) => (
            <AllNoteCard
              key={note.id}
              note={note}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onOpenTicker={handleOpenTicker}
              isEditing={editingId === note.id}
              setEditing={(v) => setEditingId(v ? note.id : null)}
              onOpenImage={() => {
                setEditingId(note.id);
                setImageModalVisible(true);
              }}
              pendingImage={pendingEditImg?.id === note.id ? pendingEditImg.snippet : null}
              onAfterImageInserted={() => {
                if (pendingEditImg?.id === note.id) setPendingEditImg(null);
              }}
            />
          ))}
        </View>
      )}

      <InsertImageUrlModal
        visible={imageModalVisible}
        onClose={() => setImageModalVisible(false)}
        onInsert={handleImageInsertFromModal}
      />
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl + spacing.md },
  headerRow: { marginBottom: spacing.md },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 22, color: colors.onBackground },
  subheader: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, marginTop: 2 },

  chipsRow: { paddingVertical: spacing.sm, gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.full,
    backgroundColor: colors.surfaceVariant, borderWidth: 1, borderColor: colors.outlineVariant,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  chipLabelActive: { color: colors.onPrimary },

  feed: { gap: spacing.md },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.outlineVariant,
    padding: spacing.md, gap: spacing.sm,
  },
  cardPressed: { backgroundColor: colors.surfaceVariant },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tickerBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.default,
    backgroundColor: colors.primaryContainer,
  },
  tickerText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.onPrimaryContainer },
  timestamp: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant },
  cardActions: { flexDirection: 'row', gap: spacing.sm },

  cardPreview: {},
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.outlineVariant, paddingTop: spacing.sm,
  },
  footerHint: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },

  empty: {
    fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant,
    textAlign: 'center', marginTop: spacing.xxl,
  },
  emptyState: {
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xxl * 2, paddingHorizontal: spacing.xl,
  },
  emptyStateTitle: {
    fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onBackground,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  emptyStateHint: {
    fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant,
    textAlign: 'center', lineHeight: 18,
  },

  composer: { gap: spacing.sm },
  composerInput: {
    backgroundColor: colors.surfaceVariant, borderRadius: radii.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 80,
    fontFamily: fonts.body, fontSize: 14, color: colors.onSurface,
  },
  previewBox: {
    borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.lg,
    padding: spacing.sm, backgroundColor: colors.surface,
  },
  previewLabel: {
    fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceVariant },
  saveButton: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radii.default,
  },
  saveButtonDisabled: { backgroundColor: colors.surfaceVariant },
  saveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onPrimary },
});
