// core/ErrorBoundary.tsx
// Pre-launch pass (2026-07-26). Before this, a render-time throw anywhere
// in the tree - a bad navigation param, a null where a bucket was
// expected, whatever - took down the entire app to a blank white/black
// screen with nothing logged anywhere a real user could see, and no way
// back in short of force-quitting.
//
// Deliberately a class component (componentDidCatch/getDerivedStateFromError
// have no hook equivalent) and deliberately NOT using useThemeColors() or
// any other context - if the crash originated inside a provider higher up
// the tree, this needs to render something sane without depending on
// anything that might itself be in a broken state. Same reasoning as the
// fontsLoaded loading branch in App.tsx: read the OS color scheme directly
// via Appearance rather than assuming ThemeProvider is healthy.
//
// Reports to Firebase Crashlytics (native) via componentDidCatch below - see
// core/crashReporting.native.ts for what actually gets sent and why. Web has
// no Crashlytics product; core/crashReporting.web.ts is a console.error
// stub with the same shape so this file doesn't need its own Platform check.

import React from 'react';
import { View, Text, Pressable, StyleSheet, Appearance, Platform } from 'react-native';
import { lightColors, darkColors, fonts, spacing, radii, ThemeColors } from './theme';
import * as crashReporting from './crashReporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught a render error', error, errorInfo.componentStack);
    crashReporting.recordError(error, {
      componentStack: (errorInfo.componentStack ?? '').slice(0, 500), // Crashlytics custom keys have a length cap
      source: 'ErrorBoundary',
    });
  }

  // Resets local state so the tree below remounts fresh - fixes anything
  // that was a one-off (bad params from a stale navigation state, a
  // transient data glitch). Doesn't fix a deterministic bug that throws
  // again on the same input, but "try again" costing nothing is still
  // strictly better than no recovery path at all.
  handleTryAgain = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const colors = Appearance.getColorScheme() === 'dark' ? darkColors : lightColors;
    const styles = createStyles(colors);

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Ani hit an unexpected error and couldn't continue. Your portfolio data is stored locally and hasn't been
          affected - try again below.
        </Text>
        <Pressable style={styles.button} onPress={this.handleTryAgain}>
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
        {Platform.OS === 'web' && (
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => window.location.reload()}>
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Reload Page</Text>
          </Pressable>
        )}
      </View>
    );
  }
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background, padding: spacing.xl,
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.onBackground, marginBottom: spacing.sm },
  body: {
    fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant,
    textAlign: 'center', marginBottom: spacing.lg, maxWidth: 360,
  },
  button: {
    backgroundColor: colors.primary, borderRadius: radii.xl,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm, minWidth: 160, alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.outline },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onPrimary },
  buttonTextSecondary: { color: colors.onSurface },
});
