// core/auth.ts
// Google sign-in (sync-plan.md §5: "Auth method: Google sign-in" - rejected
// anon-then-upgrade since both devices need the same uid from install).
// Uses expo-auth-session's Google provider to get a Google ID token, then
// hands it to Firebase Auth via signInWithCredential - this works in the
// managed Expo workflow with no native modules, unlike
// @react-native-firebase/auth (see sync-plan.md §3 on the SDK choice).
//
// TODO(Rachelle): in Google Cloud Console for the Firebase project's
// underlying GCP project, create OAuth client IDs (Web application, iOS,
// Android) under APIs & Services > Credentials, then add to .env:
//
//   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=....apps.googleusercontent.com
//   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=....apps.googleusercontent.com
//
// The web client ID also covers Expo Go / dev-client testing. See
// https://docs.expo.dev/guides/google-authentication/ for the exact
// per-platform setup (Android needs the Expo dev client's SHA-1
// fingerprint registered).

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import {
  GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut,
  onAuthStateChanged, type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './firebaseConfig';

// Lets the browser-based auth flow hand control back to the app when it
// completes - required once per app, has no effect if there's no pending
// session.
WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  /** null until Firebase resolves the current session (see `initializing`),
   *  and null again after sign-out / if never signed in. */
  user: User | null;
  /** True only while Firebase is checking for an existing session on app
   *  start - distinct from `signingIn`, which covers the interactive flow. */
  initializing: boolean;
  signingIn: boolean;
  error: string | null;
  /** True once .env has real Firebase config - see firebaseConfig.ts. */
  configured: boolean;
  /** No-op (with an error set) if the Google auth request isn't ready yet
   *  or Firebase isn't configured - always safe to call from a button. */
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(configured);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (!configured) return;
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setInitializing(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success' && response.params.id_token) {
      setSigningIn(true);
      setError(null);
      const credential = GoogleAuthProvider.credential(response.params.id_token);
      signInWithCredential(getFirebaseAuth(), credential)
        .catch((e) => setError(e?.message ?? 'Sign-in failed'))
        .finally(() => setSigningIn(false));
    } else if (response.type === 'error') {
      setError(response.error?.message ?? 'Sign-in failed');
    }
    // 'cancel' / 'dismiss' / 'opened' / 'locked' need no handling - the
    // user closed the prompt or it's still in flight.
  }, [response]);

  const signIn = useCallback(() => {
    if (!configured) { setError('Sync isn\u2019t set up yet.'); return; }
    if (!request) { setError('Still preparing sign-in - try again in a moment.'); return; }
    setError(null);
    promptAsync();
  }, [configured, request, promptAsync]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    await firebaseSignOut(getFirebaseAuth());
  }, [configured]);

  const value = useMemo<AuthState>(
    () => ({ user, initializing, signingIn, error, configured, signIn, signOut }),
    [user, initializing, signingIn, error, configured, signIn, signOut]
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
