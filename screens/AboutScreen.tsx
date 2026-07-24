// screens/AboutScreen.tsx
// Static "About" page - who built the app, what it's for, and version info.
// Pure content, no data fetching. Fill in the bracketed placeholders below
// (app display name, version, contact) before shipping.

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { spacing, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';

// TODO: pull this from app.json / Constants.expoConfig.version instead of
// hardcoding, so it never drifts from the actual build.
const APP_NAME = '[APP_NAME]';
const APP_VERSION = '[APP_VERSION]';

function Section({ title, styles, children }: { title: string; styles: ReturnType<typeof createStyles>; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Body({ styles, children }: { styles: ReturnType<typeof createStyles>; children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export default function AboutScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>About {APP_NAME}</Text>
      <Text style={styles.subheader}>Version {APP_VERSION}</Text>

      <Section title="What this app does" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} is a portfolio tracker for Philippine stock and mutual fund investments, built around a
          multi-bucket, yield-bracket strategy - see "Why Multiple Buckets?" from the Buckets screen for the full
          explanation. It combines holdings from multiple broker accounts into a single view while keeping each
          bucket's purchases and performance separate.
        </Body>
      </Section>

      <Section title="Not financial advice" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} is a personal record-keeping tool. It doesn't recommend, endorse, or execute trades, and
          nothing in the app should be read as investment, tax, or legal advice. Always verify your holdings and
          balances against your official broker statements.
        </Body>
      </Section>

      <Section title="Built independently" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} is built and maintained by an independent developer, not affiliated with any broker,
          mutual fund company, or the Philippine Stock Exchange. Stock and fund data shown in the app is imported
          from your own broker statements.
        </Body>
      </Section>

      <Section title="More" styles={styles}>
        <Body styles={styles}>
          For how the app is intended to be used, see the Terms of Use. For what data the app stores and how,
          see the Privacy Policy. To reach the developer directly, see Contact.
        </Body>
      </Section>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
  subheader: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, lineHeight: 21 },
});
