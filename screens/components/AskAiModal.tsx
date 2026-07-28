// screens/components/AskAiModal.tsx
// Bottom-sheet modal for the "Ask AI" feature. Generates a data-filled
// prompt (via `loadPrompt`, sync or async - StockDetailScreen's fetches
// CompanyDetails, WatchListScreen's just reads state already in memory)
// and shows it in a scrollable, copyable box. This app never calls an AI
// API itself here - the person pastes the copied text into whatever AI
// chat they already use. Visual pattern borrowed from
// ImportPortfolioModal.tsx (bottom sheet, overlay, header with close X)
// so this doesn't introduce a second modal style.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { GLOBAL_DATA_DISCLAIMER } from '../../core/branding';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Builds the prompt text. Called fresh every time the sheet opens, so
   *  it always reflects current prices/holdings rather than a stale copy
   *  captured at first render. */
  loadPrompt: () => Promise<string> | string;
}

export default function AskAiModal({ visible, onClose, title, subtitle, loadPrompt }: Props) {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setCopied(false);
    setPrompt(null);
    setLoading(true);
    Promise.resolve(loadPrompt())
      .then((text) => { if (!cancelled) setPrompt(text); })
      .catch((e: any) => { if (!cancelled) setPrompt(`Could not build the prompt: ${e?.message ?? String(e)}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible]);

  async function handleCopy() {
    if (!prompt) return;
    await Clipboard.setStringAsync(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <View style={styles.titleRow}>
                <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                <Text style={styles.title}>{title}</Text>
              </View>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
              <Text style={styles.hint}>
                Copy this and paste it into ChatGPT, Claude, Gemini, or any AI chat — it'll
                search the web and analyze the data below for you.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.promptBox} contentContainerStyle={styles.promptBoxContent}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Building your prompt…</Text>
              </View>
            ) : (
              <Text selectable style={styles.promptText}>{prompt}</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.disclaimer}>{GLOBAL_DATA_DISCLAIMER}</Text>
            <Pressable
              style={[styles.copyButton, (loading || !prompt) && styles.copyButtonDisabled]}
              onPress={handleCopy}
              disabled={loading || !prompt}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={colors.onPrimary}
              />
              <Text style={styles.copyButtonText}>{copied ? 'Copied!' : 'Copy Prompt'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '85%', paddingTop: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  headerText: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.onBackground },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 4 },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 6, lineHeight: 15, opacity: 0.85 },
  promptBox: {
    backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.xl,
    marginHorizontal: spacing.md, marginBottom: spacing.sm, maxHeight: 360,
  },
  promptBoxContent: { padding: spacing.md },
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  loadingText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  promptText: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.onSurface },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineVariant },
  disclaimer: { fontFamily: fonts.body, fontSize: 10, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: spacing.sm, opacity: 0.8 },
  copyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.md,
  },
  copyButtonDisabled: { opacity: 0.4 },
  copyButtonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
});
