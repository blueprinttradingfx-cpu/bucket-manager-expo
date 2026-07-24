// core/theme.ts
// Design tokens lifted directly from the Stitch export
// (stitch_bucket_portfolio_design_system[_mobile].zip -> code.html's
// tailwind.config). Both the desktop and mobile exports use the same
// token values, so there's one source of truth here rather than two.
//
// Note: DESIGN.md's frontmatter describes a dark navy palette, but the
// actual rendered code.html (and both screen.png previews) override that
// to the LIGHT palette below - the light values are what's actually on
// screen, so that's what this file implements.

// Light palette - the original Stitch-export values, unchanged.
export const lightColors = {
  // Surfaces
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceDim: '#F4F7F9',
  surfaceVariant: '#F4F7F9',
  surfaceContainerLow: '#FFFFFF',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F4F7F9',
  surfaceContainerHighest: '#ECEFF1',

  // Text
  onBackground: '#050F19',
  onSurface: '#050F19',
  onSurfaceVariant: '#5B616E',
  inverseSurface: '#050F19',
  inverseOnSurface: '#FFFFFF',

  // Outline
  outline: '#D8D8D8',
  outlineVariant: '#ECEFF1',

  // Brand / semantic
  primary: '#0052FF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#F0F3FA',
  secondary: '#0052FF',
  onSecondary: '#FFFFFF',
  positive: '#05B169',
  negative: '#DF2E2E',
  error: '#DF2E2E',

  // Yield buckets (B1 - B5). Kept identical across light/dark - they're
  // already saturated enough to read on either background, and keeping
  // one set avoids bucket colors "shifting" when the theme toggles.
  bucket1: '#FF3B30',
  bucket2: '#FF9500',
  bucket3: '#FFB119',
  bucket4: '#05B169',
  bucket5: '#0052FF',
} as const;

// Dark palette - same token set as lightColors, tuned for a dark surface.
// Brand primary/positive/negative are brightened slightly (vs. the light
// values) to keep contrast/legibility on dark backgrounds; bucket1-5 are
// intentionally left untouched (see note above).
export const darkColors = {
  // Surfaces
  background: '#0E1116',
  surface: '#171A21',
  surfaceDim: '#0E1116',
  surfaceVariant: '#1E222A',
  surfaceContainerLow: '#171A21',
  surfaceContainer: '#1B1F27',
  surfaceContainerHigh: '#22262F',
  surfaceContainerHighest: '#2A2F39',

  // Text
  onBackground: '#EAECEF',
  onSurface: '#EAECEF',
  onSurfaceVariant: '#9CA3AF',
  inverseSurface: '#EAECEF',
  inverseOnSurface: '#171A21',

  // Outline
  outline: '#3A3F4A',
  outlineVariant: '#272B34',

  // Brand / semantic
  primary: '#4C8DFF',
  onPrimary: '#04101F',
  primaryContainer: '#1B2A46',
  secondary: '#4C8DFF',
  onSecondary: '#04101F',
  positive: '#2ED47F',
  negative: '#FF6B6B',
  error: '#FF6B6B',

  bucket1: '#FF3B30',
  bucket2: '#FF9500',
  bucket3: '#FFB119',
  bucket4: '#05B169',
  bucket5: '#0052FF',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceDim: string;
  surfaceVariant: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onBackground: string;
  onSurface: string;
  onSurfaceVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  secondary: string;
  onSecondary: string;
  positive: string;
  negative: string;
  error: string;
  bucket1: string;
  bucket2: string;
  bucket3: string;
  bucket4: string;
  bucket5: string;
}

// Back-compat / theme-invariant alias - see bucketColorFor() below, which
// deliberately reads bucket1-5 off of this rather than the active theme.
// Screens themselves should use useThemeColors() from core/ThemeContext,
// not this static export.
export const colors = lightColors;

/** Maps a bucket name to its design-system color by looking for a trailing
 *  digit 1-5 (matches this app's real "B2", "B3", "B4", "B5" bucket
 *  naming). Falls back to a neutral gray for any bucket that doesn't
 *  follow that convention, rather than guessing. Bucket colors are the
 *  same in light and dark themes, so no ThemeColors param is needed. */
export function bucketColorFor(bucketName: string, fallbackIndex = 0): string {
  const match = bucketName.match(/([1-5])(?!.*[1-5])/);
  if (match) {
    const n = match[1] as '1' | '2' | '3' | '4' | '5';
    return { '1': colors.bucket1, '2': colors.bucket2, '3': colors.bucket3, '4': colors.bucket4, '5': colors.bucket5 }[n];
  }
  const fallbackPalette = [colors.bucket5, colors.bucket4, colors.bucket3, colors.bucket2, colors.bucket1];
  return fallbackPalette[fallbackIndex % fallbackPalette.length];
}

// Responsive layout tokens. `wideBreakpoint` is the window width (px) at
// which web switches from the mobile-style bottom tab bar to a persistent
// left sidebar - see core/responsive.ts and App.tsx. `contentMaxWidth` caps
// how wide any screen's content column can grow so it reads like a web app
// (a centered column) instead of a phone layout stretched full-bleed across
// a desktop monitor.
export const layout = {
  wideBreakpoint: 768,
  sidebarWidth: 240,
  contentMaxWidth: 1040,
} as const;

// Spread this into any screen's outer `container` style. Caps width and
// centers the column on wide viewports; a no-op on phones/narrow web since
// maxWidth never kicks in below that width.
export const centeredContent = {
  width: '100%',
  maxWidth: layout.contentMaxWidth,
  alignSelf: 'center',
} as const;

export const spacing = {
  base: 4,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 48,
  gutter: 20,
} as const;

// Matches the Stitch export's tailwind borderRadius scale exactly:
// DEFAULT: 0.125rem (2px), lg: 4px, xl: 8px, full: pill.
export const radii = {
  default: 2,
  lg: 4,
  xl: 8,
  full: 9999,
} as const;

// Font family names as registered with expo-font in App.tsx via
// @expo-google-fonts/inter and @expo-google-fonts/jetbrains-mono.
export const fonts = {
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoSemiBold: 'JetBrainsMono_600SemiBold',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

// Pre-built text styles matching the DESIGN.md typography scale. Use
// these instead of ad-hoc fontSize/fontFamily pairs so screens stay
// consistent with each other.
export const textStyles = {
  headlineLg: { fontFamily: fonts.body, fontSize: 24, lineHeight: 32, color: colors.onBackground },
  marketValue: { fontFamily: fonts.bodySemiBold, fontSize: 32, lineHeight: 40, letterSpacing: -0.3, color: colors.onSurface },
  bodyLg: { fontFamily: fonts.body, fontSize: 18, lineHeight: 28, color: colors.onSurface },
  bodyMd: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.onSurface },
  tickerLabel: { fontFamily: fonts.monoSemiBold, fontSize: 14, lineHeight: 20, letterSpacing: 0.3, color: colors.onSurface },
  tabularData: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 20, color: colors.onSurface },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, color: colors.onSurfaceVariant },
} as const;
