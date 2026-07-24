// screens/TermsOfUseScreen.tsx
// Static "Terms of Use" page. This is a generic starting template, not legal
// advice - review it (ideally with a lawyer) before shipping, and fill in
// the bracketed placeholders. Note: Google Play requires a *hosted, public
// URL* for your terms/privacy policy in the Play Console listing - this
// in-app screen is a convenience copy for users, not a substitute for that.

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { spacing, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';

const APP_NAME = '[APP_NAME]';
const EFFECTIVE_DATE = '[EFFECTIVE_DATE]';
const GOVERNING_LAW = '[GOVERNING_LAW / JURISDICTION]';
const SUPPORT_EMAIL = '[SUPPORT_EMAIL]';

type Styles = ReturnType<typeof createStyles>;

function Section({ title, styles, children }: { title: string; styles: Styles; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Body({ styles, children }: { styles: Styles; children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export default function TermsOfUseScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Terms of Use</Text>
      <Text style={styles.subheader}>Effective {EFFECTIVE_DATE}</Text>

      <Section title="1. Acceptance of these terms" styles={styles}>
        <Body styles={styles}>
          By downloading, installing, or using {APP_NAME} ("the app"), you agree to these Terms of Use. If you
          don't agree, please don't use the app.
        </Body>
      </Section>

      <Section title="2. What the app is" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} is a personal portfolio-tracking tool for organizing your own stock and mutual fund
          holdings using a multi-bucket, yield-bracket strategy. It is a record-keeping tool only: it does not
          place trades, hold your money or securities, or connect directly to your broker or fund company. Any
          data you see reflects information you've entered or imported yourself.
        </Body>
      </Section>

      <Section title="3. Not investment, tax, or legal advice" styles={styles}>
        <Body styles={styles}>
          Nothing in {APP_NAME} - including bucket suggestions, yield calculations, gain/loss figures, or any
          other output - constitutes investment, tax, or legal advice. Decisions about what to buy, sell, or hold
          are yours alone. Always verify figures against your official broker and fund statements before acting
          on them.
        </Body>
      </Section>

      <Section title="4. Your responsibilities" styles={styles}>
        <Body styles={styles}>
          You're responsible for the accuracy of the data you enter or import, for keeping your device secure,
          and for backing up your data as you see fit. The app is provided for your personal, non-commercial use.
        </Body>
      </Section>

      <Section title="5. No warranty" styles={styles}>
        <Body styles={styles}>
          The app is provided "as is," without warranties of any kind, express or implied, including
          calculations, fitness for a particular purpose, or uninterrupted availability. Software has bugs;
          treat any figure the app shows you as a convenience, not a guarantee, and cross-check it against your
          actual brokerage records.
        </Body>
      </Section>

      <Section title="6. Limitation of liability" styles={styles}>
        <Body styles={styles}>
          To the fullest extent permitted by law, the developer isn't liable for any investment losses, data
          loss, or other damages arising from your use of, or inability to use, the app - including losses
          resulting from inaccurate calculations, bugs, or data that fails to import or sync correctly.
        </Body>
      </Section>

      <Section title="7. Changes to the app or these terms" styles={styles}>
        <Body styles={styles}>
          The app and these terms may change over time as features are added, removed, or adjusted. Continued
          use of the app after an update means you accept the current version of these terms.
        </Body>
      </Section>

      <Section title="8. Governing law" styles={styles}>
        <Body styles={styles}>
          These terms are governed by the laws of {GOVERNING_LAW}, without regard to its conflict-of-law
          provisions.
        </Body>
      </Section>

      <Section title="9. Contact" styles={styles}>
        <Body styles={styles}>
          Questions about these terms can be sent to {SUPPORT_EMAIL}.
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
