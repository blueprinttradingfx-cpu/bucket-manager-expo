// screens/components/SidebarNav.tsx
// Persistent left nav shown instead of the bottom tab bar once the web
// window is wide enough (see core/responsive.ts's wideBreakpoint + App.tsx).
// Lives outside the Tab.Navigator tree (it sits beside it, not inside it),
// so it can't use useNavigation()/useRoute() - App.tsx drives it explicitly
// via a navigationRef and an activeKey read off the root nav state instead.
// Plain flexbox child (width fixed, height stretched by the parent row's
// default alignItems: 'stretch') rather than position: 'fixed', so it needs
// no web-only styling to stay put while a screen's own ScrollView scrolls.

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, layout, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { APP_NAME } from '../../core/branding';
import SproutMark from './SproutMark';

export interface SidebarItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

interface Props {
  items: SidebarItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
}

export default function SidebarNav({ items, activeKey, onNavigate }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <SproutMark size={18} stemColor={colors.onPrimary} />
        </View>
        <Text style={styles.brandText}>{APP_NAME}</Text>
      </View>

      <View style={styles.navList}>
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => onNavigate(item.key)}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={active ? colors.primary : colors.onSurfaceVariant}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sidebar: {
    width: layout.sidebarWidth,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.outlineVariant,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.onSurface },
  navList: { gap: spacing.xs },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
  },
  navItemActive: { backgroundColor: colors.primaryContainer },
  navLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurfaceVariant },
  navLabelActive: { color: colors.primary },
});
