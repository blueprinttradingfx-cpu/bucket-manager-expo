// screens/components/StockNotesSection.tsx
// A freeform, feed-style journal for one ticker on StockDetailScreen -
// newest note first, each entry rendered as HTML (see SimpleHtml.tsx) so a
// note can carry basic formatting (bold, links, lists) rather than only
// plain text. Presentational, same shape as WatchlistSection: the actual
// store calls (and their error handling / Alert.alert) live in
// StockDetailScreen, this component just owns its own composer/edit UI
// state and calls back up through onAdd/onUpdate/onDelete.

import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Alert from '../../core/alert';
import { StockNote } from '../../core/storeApi';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import SimpleHtml from './SimpleHtml';

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

/** Shared composer used for both "add" and "edit" - a raw-HTML TextInput
 *  with a live SimpleHtml preview underneath, so what you type is what
 *  actually renders in the feed (no surprise once you hit Save). */
function Composer({
  initialValue, submitLabel, onCancel, onSubmit,
}: {
  initialValue: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (html: string) => Promise<void>;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const trimmed = draft.trim();

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
      <TextInput
        style={styles.composerInput}
        value={draft}
        onChangeText={setDraft}
        placeholder={COMPOSER_PLACEHOLDER}
        placeholderTextColor={colors.onSurfaceVariant}
        multiline
        textAlignVertical="top"
        autoFocus
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
  note, onUpdate, onDelete,
}: {
  note: StockNote;
  onUpdate: (id: string, html: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
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

  if (editing) {
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
        />
      )}

      {loading ? (
        <Text style={styles.empty}>Loading notes...</Text>
      ) : notes.length === 0 && !composerOpen ? (
        <Text style={styles.empty}>No notes yet. Keep a running log of what you're seeing on this ticker.</Text>
      ) : (
        <View style={styles.feed}>
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </View>
      )}
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
