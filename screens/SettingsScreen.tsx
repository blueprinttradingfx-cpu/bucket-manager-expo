// screens/SettingsScreen.tsx
// Settings tab home: Appearance (theme mode) up top, then a list of the
// static info pages. Each page is its own screen in SettingsStack (see
// App.tsx) so it gets a proper header/back button on both phone and the
// wide-web sidebar layout.

import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../core/ThemeContext';
import type { ThemeMode } from '../core/ThemeContext';
import { useAuth } from '../core/AuthProvider';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { SettingsStackParamList } from '../core/navigationTypes';
import { useScreenViewLog } from '../core/useScreenViewLog';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>;

const MODE_OPTIONS: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const PAGES: { key: keyof SettingsStackParamList; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'BucketStrategyInfo', label: 'Bucket Strategy', icon: 'file-tray-stacked-outline' },
  { key: 'About', label: 'About', icon: 'information-circle-outline' },
  { key: 'Contact', label: 'Contact', icon: 'mail-outline' },
  { key: 'TermsOfUse', label: 'Terms of Use', icon: 'document-text-outline' },
  { key: 'PrivacyPolicy', label: 'Privacy Policy', icon: 'shield-checkmark-outline' },
];

export default function SettingsScreen({ navigation }: Props) {
  useScreenViewLog('Settings');
  const { colors, mode, setMode } = useTheme();
  const { user, initializing } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Settings</Text>

      <Text style={styles.sectionTitle}>Account</Text>
      <Pressable style={styles.card} onPress={() => navigation.navigate('Account')}>
        <View style={styles.row}>
          <Ionicons name="person-circle-outline" size={20} color={colors.onSurfaceVariant} style={styles.rowIcon} />
          <Text style={styles.rowLabel}>
            {initializing ? 'Checking...' : user ? (user.email ?? 'Signed in') : 'Not signed in'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
        </View>
      </Pressable>

      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={styles.segmented}>
        {MODE_OPTIONS.map((opt) => {
          const active = opt.key === mode;
          return (
            <Pressable
              key={opt.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setMode(opt.key)}
            >
              <Ionicons name={opt.icon} size={16} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        "System" follows your device's light/dark setting automatically.
      </Text>

      <Text style={styles.sectionTitle}>Pages</Text>
      <View style={styles.card}>
        {PAGES.map((page, i) => (
          <Pressable
            key={page.key}
            style={[styles.row, i < PAGES.length - 1 && styles.rowDivider]}
            onPress={() => navigation.navigate(page.key as any)}
          >
            <Ionicons name={page.icon} size={20} color={colors.onSurfaceVariant} style={styles.rowIcon} />
            <Text style={styles.rowLabel}>{page.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: spacing.lg },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  segmented: {
    flexDirection: 'row', backgroundColor: colors.surfaceVariant, borderRadius: radii.lg, padding: 4, gap: 4,
  },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.sm, borderRadius: radii.default,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant },
  segmentLabelActive: { color: colors.onPrimary },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant, marginTop: spacing.sm, lineHeight: 17 },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  rowIcon: { width: 22 },
  rowLabel: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
});
