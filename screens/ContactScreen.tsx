// screens/ContactScreen.tsx
// Static "Contact" page - how to reach the developer. Pure content plus one
// Linking call for the mailto: link; no data fetching.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { colors, spacing, fonts, radii } from '../core/theme';

// TODO: replace with the real support inbox before shipping.
const SUPPORT_EMAIL = '[SUPPORT_EMAIL]';
const APP_NAME = '[APP_NAME]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

function EmailButton() {
  const handlePress = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} support`)}`);
  };
  return (
    <Pressable style={styles.emailButton} onPress={handlePress}>
      <Text style={styles.emailButtonText}>{SUPPORT_EMAIL}</Text>
    </Pressable>
  );
}

export default function ContactScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Contact</Text>
      <Text style={styles.subheader}>Questions, bugs, or feedback about {APP_NAME}.</Text>

      <Section title="Email">
        <Body>
          The fastest way to reach the developer is by email. Tap below to open your mail app with the address
          pre-filled.
        </Body>
        <EmailButton />
      </Section>

      <Section title="Reporting a bug">
        <Body>
          If something looks wrong - a miscalculated cost basis, a bucket that isn't matching the yield you
          expect, an import that failed - include the ticker, the bucket involved, and roughly when it happened.
          A screenshot helps too.
        </Body>
      </Section>

      <Section title="Data requests">
        <Body>
          Since {APP_NAME} stores your portfolio data locally on your device rather than on a server, the
          developer can't look up or export your data on your behalf - see the Privacy Policy for details on
          what's stored and where.
        </Body>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
  subheader: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, lineHeight: 21 },
  emailButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emailButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary },
});
