// screens/components/DataDisclaimer.tsx
// Short footnote for screens that show PSE-sourced market/company data
// (WatchListScreen, StockDetailScreen) - NOT the user's own portfolio
// data, which doesn't need this (it's their own broker statements).
// Lives at the bottom of each screen's ScrollView content rather than in
// SidebarNav, since SidebarNav only renders on wide web and this needs to
// show on mobile too - see AboutScreen's "Not affiliated" section for the
// full-length version of this disclosure.

import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { fonts, spacing, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { GLOBAL_DATA_DISCLAIMER } from '../../core/branding';

export default function DataDisclaimer() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.text}>{GLOBAL_DATA_DISCLAIMER}</Text>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  text: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: colors.onSurfaceVariant,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
