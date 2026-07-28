// screens/PrivacyPolicyScreen.tsx
// Static "Privacy Policy" page. Still a starting template, not legal advice
// - review it (ideally with a lawyer) before shipping. Updated 2026-07-26
// to reflect that optional Google Sign-In + Firestore cloud sync now exist
// (core/AuthProvider.*, core/syncEngine.ts) - the previous version of this
// copy claimed "no accounts, nothing leaves your device," which stopped
// being true once that shipped. If analytics, crash reporting, or ads are
// added later, this needs another pass, and Google Play's Data Safety
// section needs updating too.
// Also note: Google Play requires a *hosted, public URL* for your privacy
// policy in the Play Console listing - this in-app screen doesn't replace
// that requirement (see App.tsx's `linking` config for the web route this
// can live at).

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { spacing, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { APP_NAME, SUPPORT_EMAIL } from '../core/branding';

// PLACEHOLDER (2026-07-26 pre-launch pass) - set to the day this was filled
// in, not an actual launch date. Bump before shipping, and again any time
// this policy's substance changes.
const EFFECTIVE_DATE = 'July 26, 2026';

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

export default function PrivacyPolicyScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Privacy Policy</Text>
      <Text style={styles.subheader}>Effective {EFFECTIVE_DATE}</Text>

      <Section title="Short version" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} stores your portfolio data - holdings, bucket definitions, and anything you import from
          broker statements - locally on your device by default, with no account required. If you choose to sign
          in with Google, the app can also back up and sync that same data to a private cloud store tied to your
          account, so it carries over to your other devices. Signing in is optional; the app is fully usable
          without it. {APP_NAME} does not sell your data, does not show ads, and does not use analytics or
          crash-reporting tools at this time.
        </Body>
      </Section>

      <Section title="What's stored, and where" styles={styles}>
        <Body styles={styles}>
          The app keeps your buckets, holdings, lot history, watchlist, and any figures you enter or import in
          local storage on your device (SQLite / IndexedDB). This data stays on your device and in your own
          device backups (for example, your phone's built-in cloud backup) regardless of whether you sign in.
        </Body>
        <Body styles={styles}>
          If you sign in with Google and use the app's sync feature, that same portfolio data (buckets,
          transactions, watchlist, and settings - not the underlying broker statement files themselves) is also
          copied to a private Firestore database (a Google Cloud service used as {APP_NAME}'s cloud backend),
          scoped so only your signed-in account can read or write it. Signing in also gives the app your Google
          account's basic profile info - name, email address, and profile photo - to identify you and show your
          account details on the Account screen. {APP_NAME} doesn't request or see your Google password, and
          doesn't request access to anything else in your Google account.
        </Body>
      </Section>

      <Section title="What the app does not do" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} does not require you to create an account - it's fully usable local-only. It does not
          collect your broker login credentials, does not sell or share your data with third parties for
          advertising or marketing, and does not connect to your broker directly - any broker statement data
          comes from files you choose to import yourself. The only outside service involved is Firebase (Google),
          used solely as {APP_NAME}'s authentication and cloud-sync backend, and only if you choose to sign in.
        </Body>
      </Section>

      <Section title="Analytics, crash reporting, and ads" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} does not use any analytics, crash reporting, or advertising SDKs as of this writing. (If
          that changes - a crash reporter is a likely future addition - this section will be updated to name the
          service and what it receives before that ships, not after.)
        </Body>
      </Section>

      <Section title="Deleting your data" styles={styles}>
        <Body styles={styles}>
          If you've never signed in, everything lives only on your device - uninstalling the app removes it, and
          the Settings screen's reset/clear-data option (if present) does the same without a full uninstall.
        </Body>
        <Body styles={styles}>
          If you've signed in and synced, "Delete My Data" on the Account screen removes your synced data from
          {' '}{APP_NAME}'s cloud store, deletes your account, and clears local data on that device, in one step.
          This can't be undone. You can also request deletion by emailing {SUPPORT_EMAIL}.
        </Body>
      </Section>

      <Section title="Children's privacy" styles={styles}>
        <Body styles={styles}>
          {APP_NAME} is not directed at children and isn't intended for use by anyone under 18, given its
          subject matter (personal investment tracking). The app doesn't knowingly collect data from children,
          consistent with the fact that it doesn't collect personal data from any user.
        </Body>
      </Section>

      <Section title="Changes to this policy" styles={styles}>
        <Body styles={styles}>
          If what the app stores or how it handles data changes - for example, if analytics or crash reporting
          is added later - this page will be updated and the effective date above will change.
        </Body>
      </Section>

      <Section title="Contact" styles={styles}>
        <Body styles={styles}>
          Questions about this policy can be sent to {SUPPORT_EMAIL}.
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
