// screens/components/StockNotesSection.tsx
// A freeform, feed-style journal for one ticker on StockDetailScreen -
// newest note first, each entry rendered as HTML (see SimpleHtml.tsx) so a
// note can carry basic formatting (bold, links, lists, images) rather than
// only plain text.
//
// Presentational: the actual store calls (and their error handling /
// Alert.alert) live in StockDetailScreen, this component just owns its own
// composer/edit UI state and calls back up through onAdd/onUpdate/onDelete.
//
// T-02b adds a 7-button formatting toolbar (shared NoteComposerToolbar.tsx)
// above the composer's TextInput, plus an InsertImageUrlModal mounted once
// at the section level and shared between the add-composer and any in-feed
// edit-composer — whichever one is currently "active" gets the inserted
// snippet.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Alert from '../../core/alert';
import { StockNote } from '../../core/storeApi';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import SimpleHtml from './SimpleHtml';
import NoteComposerToolbar from './NoteComposerToolbar';
import InsertImageUrlModal from './InsertImageUrlModal';

interface Props {
  notes: StockNote[];
  loading: boolean;
  onAdd: (contentHtml: string) => Promise<void>;
  onUpdate: (id: string, contentHtml: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const COMPOSER_PLACEHOLDER =
  'Write a note... basic HTML is supported, e.g. <b>bold</b>, <a href="https://...">link</a>, <ul><li>item</li></ul>';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

type ActiveComposer =
  | { kind: 'add' }
  | { kind: 'edit'; id: string };

/** Shared composer used for both "add" and "edit". Owns draft state +
 *  selection state so the formatting toolbar can insert at the correct
 *  cursor. `toolbarSelection`/`setToolbarSelection` come from the parent
 *  because the toolbar (technically its modal) needs to mutate selection
 *  across composers. */
function Composer({
  initialValue,
  submitLabel,
  onCancel,
  onSubmit,
  onOpenImage,
  imageInsertedText,
  onAfterImageInserted,
}: {
  initialValue: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (html: string) => Promise<void>;
  onOpenImage: () => void;
  /** Snippet to splice in from the parent's InsertImageUrlModal result, if
   *  any. When non-null, the composer inserts it at the current selection
   *  and immediately calls `onAfterImageInserted()` so the parent clears it. */
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

  // Modal just resolved to an img snippet. Insert at the stored selection,
  // then tell the parent to null out the pending insert so we don't loop.
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
      // Fallback: append
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
        onChangeText={(next) => setDraft(next)}
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
        placeholder={COMPOSER_PLACEHOLDER}
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

function NoteCard({
  note,
  onUpdate,
  onDelete,
  isEditing,
  setEditing,
  onOpenImageForEdit,
  pendingImageForEdit,
  onAfterEditImageInserted,
}: {
  note: StockNote;
  onUpdate: (id: string, html: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isEditing: boolean;
  setEditing: (v: boolean) => void;
  onOpenImageForEdit: (id: string) => void;
  pendingImageForEdit: string | null;
  onAfterEditImageInserted: () => void;
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
          onOpenImage={() => onOpenImageForEdit(note.id)}
          imageInsertedText={pendingImageForEdit}
          onAfterImageInserted={onAfterEditImageInserted}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.timestamp}>{formatTimestamp(note.createdAt)}</Text>
        <View style={styles.cardActions}>
          <Pressable onPress={() => setEditing(true)} hitSlop={8} disabled={deleting}>
            <Ionicons name="pencil-outline" size={15} color={colors.onSurfaceVariant} />
          </Pressable>
          <Pressable onPress={confirmDelete} hitSlop={8} disabled={deleting}>
            <Ionicons name="trash-outline" size={15} color={deleting ? colors.onSurfaceVariant : colors.negative} />
          </Pressable>
        </View>
      </View>
      <SimpleHtml html={note.contentHtml} />
    </View>
  );
}

export default function StockNotesSection({ notes, loading, onAdd, onUpdate, onDelete }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // One shared InsertImageUrlModal. We need to know WHICH composer is active
  // so we know which draft to splice the img snippet into.
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [pendingAddImg, setPendingAddImg] = useState<string | null>(null);
  const [pendingEditImg, setPendingEditImg] = useState<{ id: string; snippet: string } | null>(null);

  const activeComposer: ActiveComposer | null = composerOpen
    ? { kind: 'add' }
    : editingId
      ? { kind: 'edit', id: editingId }
      : null;

  const handleImageInsertFromModal = useCallback((snippet: string) => {
    if (activeComposer?.kind === 'add') {
      setPendingAddImg(snippet);
    } else if (activeComposer?.kind === 'edit') {
      setPendingEditImg({ id: activeComposer.id, snippet });
    }
    // Else: no active composer — shouldn't happen because the modal can only
    // be opened from a toolbar press on an active composer. Safe to drop.
  }, [activeComposer]);

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Notes</Text>
        {!composerOpen && (
          <Pressable style={styles.addButton} onPress={() => setComposerOpen(true)}>
            <Ionicons name="add" size={14} color={colors.primary} />
            <Text style={styles.addButtonText}>Add Note</Text>
          </Pressable>
        )}
      </View>

      {composerOpen && (
        <Composer
          initialValue=""
          submitLabel="Post"
          onCancel={() => setComposerOpen(false)}
          onSubmit={async (html) => {
            await onAdd(html);
            setComposerOpen(false);
          }}
          onOpenImage={() => setImageModalVisible(true)}
          imageInsertedText={pendingAddImg}
          onAfterImageInserted={() => setPendingAddImg(null)}
        />
      )}

      {loading ? (
        <Text style={styles.empty}>Loading notes...</Text>
      ) : notes.length === 0 && !composerOpen ? (
        <Text style={styles.empty}>No notes yet. Keep a running log of what you're seeing on this ticker.</Text>
      ) : (
        <View style={styles.feed}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={onUpdate}
              onDelete={onDelete}
              isEditing={editingId === note.id}
              setEditing={(v) => setEditingId(v ? note.id : null)}
              onOpenImageForEdit={(id) => {
                setEditingId(id);
                setImageModalVisible(true);
              }}
              pendingImageForEdit={pendingEditImg?.id === note.id ? pendingEditImg.snippet : null}
              onAfterEditImageInserted={() => {
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
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontFamily: fonts.body, fontSize: 20, color: colors.onBackground },
  addButton: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
  },
  addButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.primary },
  empty: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  feed: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  timestamp: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  composer: {
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.xl, padding: spacing.md, marginBottom: spacing.md,
  },
  composerInput: {
    fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface, minHeight: 90,
    borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, backgroundColor: colors.surface,
  },
  previewBox: {
    marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.outlineVariant, paddingTop: spacing.sm,
  },
  previewLabel: {
    fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: spacing.xs,
  },
  composerActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm,
  },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  saveButton: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm - 2 },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onPrimary },
});
