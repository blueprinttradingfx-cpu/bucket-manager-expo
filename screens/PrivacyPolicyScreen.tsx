// screens/PrivacyPolicyScreen.tsx
// Static "Privacy Policy" page. This is a generic starting template, not
// legal advice - review it (ideally with a lawyer) before shipping, and
// fill in the bracketed placeholders. IMPORTANT: this copy assumes the app
// stores portfolio data locally on-device (SQLite/IndexedDB) with no user
// accounts and no server sync. If that changes - e.g. cloud backup, sign-in,
// analytics, or ads are added later - this page needs a rewrite to disclose
// that, and Google Play's Data Safety section will need updating too.
// Also note: Google Play requires a *hosted, public URL* for your privacy
// policy in the Play Console listing - this in-app screen doesn't replace
// that requirement.

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, fonts } from '../core/theme';

const APP_NAME = '[APP_NAME]';
const EFFECTIVE_DATE = '[EFFECTIVE_DATE]';
const SUPPORT_EMAIL = '[SUPPORT_EMAIL]';

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

export default function PrivacyPolicyScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Privacy Policy</Text>
      <Text style={styles.subheader}>Effective {EFFECTIVE_DATE}</Text>

      <Section title="Short version">
        <Body>
          {APP_NAME} stores your portfolio data - holdings, bucket definitions, and anything you import from
          broker statements - locally on your device. It isn't uploaded to a server, and there's no account or
          sign-in. The developer doesn't see, collect, or have access to your data.
        </Body>
      </Section>

      <Section title="What's stored, and where">
        <Body>
          The app keeps your buckets, holdings, lot history, and any figures you enter or import in local storage
          on your device (SQLite / IndexedDB). This data stays on your device and in your own device backups (for
          example, if you use your phone's built-in cloud backup) - {APP_NAME} itself doesn't transmit it
          anywhere.
        </Body>
      </Section>

      <Section title="What the app does not do">
        <Body>
          {APP_NAME} does not require you to create an account, does not collect your name, email, or broker
          login credentials, and does not sell or share your portfolio data with third parties. It doesn't
          connect to your broker directly - any broker statement data comes from files you choose to import
          yourself.
        </Body>
      </Section>

      <Section title="Analytics, crash reporting, and ads">
        <Body>
          [Fill in honestly based on what's actually integrated: e.g. "This app does not use any analytics,
          crash reporting, or advertising SDKs," or, if it does, name the service (such as a crash reporter) and
          what data it receives.]
        </Body>
      </Section>

      <Section title="Deleting your data">
        <Body>
          Since everything lives on your device, uninstalling the app removes its stored data. If the app offers
          an in-app reset or clear-data option, using that will do the same without a full uninstall.
        </Body>
      </Section>

      <Section title="Children's privacy">
        <Body>
          {APP_NAME} is not directed at children and isn't intended for use by anyone under 18, given its
          subject matter (personal investment tracking). The app doesn't knowingly collect data from children,
          consistent with the fact that it doesn't collect personal data from any user.
        </Body>
      </Section>

      <Section title="Changes to this policy">
        <Body>
          If what the app stores or how it handles data changes - for example, if cloud sync or an account
          system is added later - this page will be updated and the effective date above will change.
        </Body>
      </Section>

      <Section title="Contact">
        <Body>
          Questions about this policy can be sent to {SUPPORT_EMAIL}.
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
});
