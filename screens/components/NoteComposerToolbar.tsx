// screens/components/NoteComposerToolbar.tsx
// Formatting toolbar above a note-composer TextInput. Each button inserts a
// small HTML snippet at the caller-provided selection range (or wraps the
// selected text), falling back to "append at end with a one-time hint" if
// selection info is unavailable on the current platform.
//
// Outputs raw HTML matching the tag subset that SimpleHtml.tsx already
// renders: <b>, <i>, <ul>/<li>, <a href>, <img src> (via modal, see
// InsertImageUrlModal), <blockquote> — plus a "Clear Formatting" button
// that strips tags from the selection (or the whole draft if no selection).

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

export interface NoteComposerToolbarProps {
  value: string;
  selection: { start: number; end: number };
  onChangeText: (next: string) => void;
  /** Fired after snippet insertion so the parent can collapse the native
   *  cursor to the end of what was just inserted. */
  onAfterInsert?: (newCursorPos: number) => void;
  onImagePressed: () => void;
}

const CLEAR_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[^>]*)?\s*\/?>/g;

function stripTags(s: string): string {
  return s.replace(CLEAR_TAG_RE, '');
}

type ToolKey = 'bold' | 'italic' | 'list' | 'link' | 'image' | 'quote' | 'clear';

interface ToolDef {
  key: ToolKey;
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  labelLong: string;
}

const TOOLS: ToolDef[] = [
  { key: 'bold',   label: 'B',  labelLong: 'Bold' },
  { key: 'italic', label: 'I',  labelLong: 'Italic' },
  { key: 'list',   icon: 'list-outline',          labelLong: 'Bulleted List' },
  { key: 'link',   icon: 'link-outline',          labelLong: 'Link' },
  { key: 'image',  icon: 'image-outline',         labelLong: 'Insert Image URL' },
  { key: 'quote',  icon: 'chatbox-ellipses-outline', labelLong: 'Quote' },
  { key: 'clear',  icon: 'refresh-outline',       labelLong: 'Clear Formatting' },
];

export default function NoteComposerToolbar({
  value, selection, onChangeText, onAfterInsert, onImagePressed,
}: NoteComposerToolbarProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [appendHint, setAppendHint] = useState(false);

  /** Returns [newValue, newCursorPos] or null if we couldn't use selection. */
  function buildSnippet(fn: (selected: string) => string): { next: string; pos: number } | null {
    try {
      // Defensive: selection.start / selection.end can be NaN/undefined on
      // some native implementations. Coerce to valid numbers, falling back
      // to "end of string" if anything looks wrong.
      let start = Number(selection?.start);
      let end = Number(selection?.end);
      if (!Number.isFinite(start)) start = value.length;
      if (!Number.isFinite(end)) end = value.length;
      if (start < 0) start = 0;
      if (end < start) end = start;
      if (end > value.length) end = value.length;
      if (start > value.length) start = value.length;

      const selected = value.slice(start, end);
      const inserted = fn(selected);
      const next = value.slice(0, start) + inserted + value.slice(end);
      const pos = start + inserted.length;
      return { next, pos };
    } catch (e) {
      console.warn('[NoteComposerToolbar] selection build failed:', e);
      return null;
    }
  }

  function applySnippet(fn: (selected: string) => string) {
    const res = buildSnippet(fn);
    if (!res) {
      onChangeText(value + fn(''));
      setAppendHint(true);
      setTimeout(() => setAppendHint(false), 3500);
      return;
    }
    onChangeText(res.next);
    onAfterInsert?.(res.pos);
  }

  function runTool(tool: ToolKey) {
    switch (tool) {
      case 'bold':
        applySnippet((sel) => sel ? `<b>${sel}</b>` : '<b>bold text</b>');
        return;
      case 'italic':
        applySnippet((sel) => sel ? `<i>${sel}</i>` : '<i>italic text</i>');
        return;
      case 'list':
        applySnippet((sel) => {
          if (sel) {
            const lines = sel.split(/\r?\n/).filter((l) => l.trim().length > 0);
            if (lines.length === 0) return `<ul>\n<li>list item</li>\n</ul>\n`;
            return `<ul>\n${lines.map((l) => `  <li>${l}</li>`).join('\n')}\n</ul>\n`;
          }
          return `<ul>\n  <li>item 1</li>\n  <li>item 2</li>\n</ul>\n`;
        });
        return;
      case 'link':
        applySnippet((sel) => {
          const body = sel || 'link text';
          return `<a href="https://">${body}</a>`;
        });
        return;
      case 'image':
        onImagePressed();
        return;
      case 'quote':
        applySnippet((sel) => {
          if (sel) return `<blockquote>\n${sel}\n</blockquote>\n`;
          return `<blockquote>quoted passage</blockquote>\n`;
        });
        return;
      case 'clear': {
        try {
          const start = Math.max(0, Math.min(Number(selection?.start) || 0, value.length));
          let end = Math.max(start, Math.min(Number(selection?.end) || 0, value.length));
          if (end === start) {
            // No explicit selection → strip tags from the whole draft
            const cleared = stripTags(value);
            onChangeText(cleared);
            onAfterInsert?.(cleared.length);
            return;
          }
          const selected = value.slice(start, end);
          const cleared = stripTags(selected);
          const next = value.slice(0, start) + cleared + value.slice(end);
          onChangeText(next);
          onAfterInsert?.(start + cleared.length);
        } catch (e) {
          console.warn('[NoteComposerToolbar] clear failed, falling back to whole-draft strip:', e);
          onChangeText(stripTags(value));
        }
        return;
      }
    }
  }

  function labelStyleFor(tool: ToolKey): object | null {
    if (tool === 'bold')   return { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onSurface };
    if (tool === 'italic') return { fontFamily: fonts.body, fontSize: 14, fontStyle: 'italic', color: colors.onSurface };
    return null;
  }

  return (
    <>
      <View style={styles.toolbar}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.key}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => runTool(t.key)}
            hitSlop={6}
            accessibilityLabel={t.labelLong}
          >
            {t.icon ? (
              <Ionicons name={t.icon} size={16} color={colors.onSurfaceVariant} />
            ) : (
              <Text style={labelStyleFor(t.key)}>{t.label}</Text>
            )}
          </Pressable>
        ))}
      </View>
      {appendHint ? (
        <View style={styles.hintRow}>
          <Ionicons name="information-circle-outline" size={14} color={colors.onSurfaceVariant} />
          <Text style={styles.hintText}>Selection unavailable — snippet appended to end.</Text>
        </View>
      ) : null}
    </>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    padding: 4,
    gap: 2,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  btn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.default,
    minWidth: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  hintText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
});
