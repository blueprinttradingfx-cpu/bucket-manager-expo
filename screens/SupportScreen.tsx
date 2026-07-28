// screens/SupportScreen.tsx
// Static "Support the Developer" / donate page. Pure content plus two
// external-link mechanisms - Linking.openURL() for Buy Me a Coffee and
// expo-clipboard for the GCash/Maya number - deliberately NOT an in-app
// payment flow. Apple/Google review a real in-app payment/donation flow
// under their in-app-purchase rules; opening the system browser or just
// copying a number to send from the person's own GCash/Maya app sidesteps
// that entirely, the same way EmailButton in ContactScreen.tsx opens the
// mail app instead of sending mail from inside this app.
//
// TODO before shipping: fill in the placeholder constants in
// core/branding.ts (GCASH_NAME, GCASH_NUMBER, GCASH_QR_IMAGE_URL,
// BUY_ME_A_COFFEE_USERNAME) - see that file's comments for what each one
// needs. GCASH_QR_IMAGE_URL is optional; leaving it as the placeholder just
// skips the QR image and keeps the copyable name/number.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { spacing, fonts, radii, centeredContent, ThemeColors } from '../core/theme';
import { useThemeColors } from '../core/ThemeContext';
import { APP_NAME, GCASH_NAME, GCASH_NUMBER, GCASH_QR_IMAGE_URL, BUY_ME_A_COFFEE_USERNAME } from '../core/branding';

const hasGcashQr = GCASH_QR_IMAGE_URL !== '[GCASH_QR_IMAGE_URL]' && GCASH_QR_IMAGE_URL.length > 0;
const buyMeACoffeeUrl = `https://www.buymeacoffee.com/${BUY_ME_A_COFFEE_USERNAME}`;

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

export default function SupportScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [copied, setCopied] = useState(false);

  const handleCopyNumber = async () => {
    await Clipboard.setStringAsync(GCASH_NUMBER);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBuyMeACoffee = () => {
    Linking.openURL(buyMeACoffeeUrl);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Support the Developer</Text>
      <Text style={styles.subheader}>
        {APP_NAME} is free, independently built, and has no ads or subscriptions. If it's useful to you,
        a donation - of any size - helps keep it maintained. Entirely optional, never required to use any
        feature of the app.
      </Text>

      <Section title="GCash / Maya" styles={styles}>
        <Body styles={styles}>
          Send directly from your GCash or Maya app using the details below.
        </Body>
        <Pressable style={styles.copyCard} onPress={handleCopyNumber}>
          <View style={{ flex: 1 }}>
            <Text style={styles.copyName}>{GCASH_NAME}</Text>
            <Text style={styles.copyNumber}>{GCASH_NUMBER}</Text>
          </View>
          <View style={styles.copyBadge}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} />
            <Text style={styles.copyBadgeText}>{copied ? 'Copied' : 'Copy'}</Text>
          </View>
        </Pressable>
        {hasGcashQr && (
          <Image source={{ uri: GCASH_QR_IMAGE_URL }} style={styles.qrImage} resizeMode="contain" />
        )}
      </Section>

      <Section title="Buy Me a Coffee" styles={styles}>
        <Body styles={styles}>
          Prefer a card or a one-time link instead? Buy Me a Coffee opens in your browser.
        </Body>
        <Pressable style={styles.bmcButton} onPress={handleOpenBuyMeACoffee}>
          <Ionicons name="cafe-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.bmcButtonText}>Buy Me a Coffee</Text>
        </Pressable>
      </Section>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
  subheader: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.lg, lineHeight: 19 },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, lineHeight: 21, marginBottom: spacing.sm },
  copyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  copyName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurface },
  copyNumber: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.onSurface, marginTop: 2 },
  copyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceVariant, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  copyBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.primary },
  qrImage: { width: 200, height: 200, alignSelf: 'center', marginTop: spacing.md, borderRadius: radii.default },
  bmcButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.md, alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
  },
  bmcButtonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
});
