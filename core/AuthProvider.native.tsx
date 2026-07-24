// core/AuthProvider.native.tsx
// Metro resolves './AuthProvider' to THIS file on iOS/Android (same
// convention as './db' and './StoreProvider'). Same AuthContextValue shape
// as the web provider, so AccountScreen/SettingsScreen are identical
// across platforms - only what's inside signInWithGoogle() differs.
//
// Uses @react-native-google-signin/google-signin (Expo's current official
// recommendation - option (B) from the earlier TODO here). Requires an EAS
// dev client build - does NOT run in Expo Go (decision made in
// sync-plan.md §6: "switch to dev client").
//
// GoogleSignin.configure() needs `webClientId` - this is the "Web client"
// OAuth entry Firebase auto-creates in the same Google Cloud project when
// you enable Google sign-in in the Firebase console, NOT the
// Android/iOS client ID. It's what lets an idToken minted by the native
// Google Sign-In SDK be verified by Firebase Auth. Comes from
// extra.googleAuth.webClientId (app.config.js -> GOOGLE_WEB_CLIENT_ID).

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut, onAuthStateChanged, User,
} from 'firebase/auth';
import { auth } from './firebaseAuth';
import { AuthContextValue, AuthUser } from './authTypes';

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL };
}

// Configuring twice is harmless but pointless - do it once, lazily, on the
// first sign-in attempt rather than at module load, so importing this file
// doesn't throw before extra.googleAuth is actually filled in.
let configured = false;
function ensureConfigured() {
  if (configured) return;
  const webClientId = Constants.expoConfig?.extra?.googleAuth?.webClientId as string | undefined;
  if (!webClientId) {
    throw new Error(
      'Google Sign-In is not configured yet - set GOOGLE_WEB_CLIENT_ID ' +
      '(see extra.googleAuth in app.config.js).'
    );
  }
  GoogleSignin.configure({ webClientId });
  configured = true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(toAuthUser(firebaseUser));
      setInitializing(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    initializing,
    async signInWithGoogle() {
      ensureConfigured();
      // No-op on iOS; on Android this prompts to install/update Play
      // Services if missing, rather than failing signIn() with an opaque error.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') return; // user cancelled - not an error
      const { idToken } = response.data;
      if (!idToken) {
        throw new Error(
          'Google did not return an ID token - double check webClientId in app.config.js.'
        );
      }
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      // onAuthStateChanged above picks up the signed-in user - no setUser here.
    },
    async signOut() {
      await firebaseSignOut(auth);
      // Also clear the native Google session - otherwise the next signIn()
      // silently reuses the cached account instead of letting the user
      // pick/confirm one, which reads as "sign out didn't work."
      if (GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }
    },
  }), [user, initializing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
