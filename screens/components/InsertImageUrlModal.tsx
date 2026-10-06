// screens/components/InsertImageUrlModal.tsx
// Bottom-sheet modal for pasting an image URL (e.g. TradingView's "share
// as image" link, a screenshot hosted on any CDN, etc.). Shows a live
// <img> preview of whatever URL the user is typing so broken links are
// caught BEFORE inserting, not after. Insert emits a tag with:
//   <img src="URL" width="100%" loading="lazy" referrerpolicy="no-referrer" />
// — the extra attrs are stripped by SimpleHtml's parseSrc (which only
// extracts `src`), but they're harmless if someone copies the raw HTML
// elsewhere.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, TextInput, Image,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the finalized `<img>` snippet. Caller inserts at cursor. */
  onInsert: (imgTag: string) => void;
}

const HTTPS_PREFIX_RE = /^https?:\/\//i;
const DISALLOWED_SCHEME_RE = /^(javascript|data|blob):/i;

function isValidImageUrl(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  if (DISALLOWED_SCHEME_RE.test(trimmed)) return false;
  return HTTPS_PREFIX_RE.test(trimmed);
}

export default function InsertImageUrlModal({ visible, onClose, onInsert }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [url, setUrl] = useState('');
  const [previewStage, setPreviewStage] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (visible) {
      setUrl('');
      setPreviewStage('idle');
    }
  }, [visible]);

  // Debounced preview load: wait until typing pauses >300ms before hitting
  // the network, so we don't fire an HTTP request on every keystroke.
  useEffect(() => {
    if (!visible) return;
    if (!isValidImageUrl(url)) {
      setPreviewStage('idle');
      return;
    }
    setPreviewStage('loading');
    const t = setTimeout(() => {
      // RN Image.prefetch OR onError/onLoad on the rendered <Image> is
      // sufficient — we just need to detect "this URL actually resolved to
      // an image" with a short timeout so the spinner doesn't spin forever
      // on dead hosts.
      const timeout = setTimeout(() => setPreviewStage('error'), 8000);
      Image.getSize(
        url.trim(),
        () => {
          clearTimeout(timeout);
          setPreviewStage('ready');
        },
        () => {
          clearTimeout(timeout);
          setPreviewStage('error');
        }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [url, visible]);

  function handleInsert() {
    const trimmed = url.trim();
    if (!isValidImageUrl(trimmed)) return;
    const tag = `<img src="${trimmed}" width="100%" loading="lazy" referrerpolicy="no-referrer" />`;
    console.log('[InsertImageUrlModal] inserting snippet, URL length:', trimmed.length);
    onInsert(tag);
    onClose();
  }

  const ok = isValidImageUrl(url);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Insert Image by URL</Text>
              <Text style={styles.subtitle}>Paste any https:// image link. TradingView screenshot CDN links work great.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.md }}
          >
            <TextInput
              style={styles.urlInput}
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/chart.png"
              placeholderTextColor={colors.onSurfaceVariant}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
            />
            {url.length > 0 && !ok ? (
              <View style={styles.warnRow}>
                <Ionicons name="warning-outline" size={14} color={colors.negative} />
                <Text style={styles.warnText}>URL must start with https:// (no javascript:/data:/blob:).</Text>
              </View>
            ) : null}

            <View style={styles.previewCard}>
              <Text style={styles.previewLabel}>Preview</Text>
              {previewStage === 'idle' ? (
                <Text style={styles.previewIdle}>Type a valid https:// URL to see it here.</Text>
              ) : previewStage === 'loading' ? (
                <View style={styles.previewSpinnerRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.previewHint}>Loading image…</Text>
                </View>
              ) : previewStage === 'error' ? (
                <View style={styles.previewError}>
                  <Ionicons name="image-outline" size={24} color={colors.onSurfaceVariant} style={{ marginBottom: spacing.sm }} />
                  <Text style={styles.previewErrorText}>Image failed to load. Double-check the URL, or try pasting a direct image address (right-click → Copy image address).</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: url.trim() }}
                  resizeMode="contain"
                  style={styles.previewImage}
                />
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerHint}>
              {ok
                ? `Image ${previewStage === 'ready' ? 'verified' : previewStage === 'loading' ? 'loading…' : previewStage === 'error' ? 'failed — still insert anyway?' : ''}`
                : 'Enter a valid https:// image URL.'}
            </Text>
            <Pressable
              style={[styles.insertButton, !ok && styles.insertButtonDisabled]}
              onPress={handleInsert}
              disabled={!ok}
            >
              <Text style={styles.insertButtonText}>Insert</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '85%',
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.onBackground },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2, lineHeight: 16 },

  urlInput: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  warnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.negative },

  previewCard: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.md,
    minHeight: 140,
  },
  previewLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  previewIdle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingVertical: 36,
  },
  previewSpinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 36,
  },
  previewHint: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  previewError: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: spacing.sm,
  },
  previewErrorText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 17,
  },
  previewImage: {
    width: '100%',
    maxHeight: 280,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  footerHint: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    paddingRight: spacing.md,
  },
  insertButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  insertButtonDisabled: { backgroundColor: colors.surfaceContainerHighest, opacity: 0.6 },
  insertButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onPrimary },
});
