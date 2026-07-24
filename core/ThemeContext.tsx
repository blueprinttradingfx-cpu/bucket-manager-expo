// core/ThemeContext.tsx
// App-wide appearance state. Lives inside StoreProvider (it persists the
// user's choice via useStore()) and outside NavigationContainer (App.tsx's
// navTheme/stackScreenOptions read colors from here). Every screen that
// wants theme-aware colors calls useThemeColors() instead of importing the
// static `colors` export from ./theme.
//
// Three modes, matching the Settings > Appearance segmented control:
// 'system' (default - follows the OS setting and updates live if it
// changes), 'light', 'dark'.

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import { lightColors, darkColors, ThemeColors } from './theme';
import { useStore } from './StoreProvider';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemIsDark, setSystemIsDark] = useState(Appearance.getColorScheme() === 'dark');

  // Load the saved preference once on mount. Defaults to 'system' (already
  // the initial state) until this resolves, so there's no flash of an
  // unrelated theme - at worst a brief moment of "system" before a saved
  // explicit choice applies.
  useEffect(() => {
    let mounted = true;
    store.getThemeMode().then((saved) => {
      if (mounted) setModeState(saved);
    });
    return () => { mounted = false; };
  }, [store]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemIsDark(colorScheme === 'dark'));
    return () => sub.remove();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    store.setThemeMode(next).catch(() => {});
  }, [store]);

  const isDark = mode === 'dark' || (mode === 'system' && systemIsDark);
  const themeColors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark, colors: themeColors, setMode }),
    [mode, isDark, themeColors, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/** Convenience hook for the common case: a screen only needs the current
 *  color set, not the mode or setter. */
export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}
