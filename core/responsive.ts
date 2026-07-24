// core/responsive.ts
// Single source of truth for "is this a wide web viewport" so the nav shell
// (App.tsx) and individual screens (e.g. Dashboard's stat grid) branch on
// the same definition. Native mobile never counts as "wide" here, even on
// a tablet, since this project's tablet/desktop-web layout hasn't been
// scoped - only the web breakpoint was requested.

import { useWindowDimensions, Platform } from 'react-native';
import { layout } from './theme';

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isWideWeb = isWeb && width >= layout.wideBreakpoint;
  return { width, height, isWeb, isWideWeb };
}
