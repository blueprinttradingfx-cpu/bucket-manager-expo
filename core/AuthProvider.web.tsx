// core/AuthProvider.web.tsx
// Web provider. signInWithPopup + GoogleAuthProvider is the whole flow here
// - Firebase handles the OAuth round-trip itself, no separate Google Cloud
// OAuth client to configure on this platform (unlike native - see
// AuthProvider.native.tsx). Same AuthContextValue/useAuth() shape as
// native, so AccountScreen/SettingsScreen don't know or care which
// platform they're running on - same pattern as StoreProvider.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged, User,
  deleteUser, reauthenticateWithPopup,
} from 'firebase/auth';
import { auth } from './firebaseAuth';
import { AuthContextValue, AuthUser } from './authTypes';
import * as crashReporting from './crashReporting';

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(toAuthUser(firebaseUser));
      setInitializing(false);
      // No-op today (crashReporting.web.ts - Crashlytics has no web
      // product), kept here so native and web stay symmetric if a web
      // error-reporting tool is ever added.
      crashReporting.setUserId(firebaseUser?.uid ?? null);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    initializing,
    async signInWithGoogle() {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // onAuthStateChanged above picks up the result - no need to setUser here.
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
    async deleteAccount() {
      const current = auth.currentUser;
      if (!current) return;
      try {
        await deleteUser(current);
      } catch (e: any) {
        // Same "requires a recent login" case as native - see that file's
        // deleteAccount for the full explanation. Web's reauth is a single
        // popup call rather than native's separate GoogleSignin round trip.
        if (e?.code !== 'auth/requires-recent-login') throw e;
        await reauthenticateWithPopup(current, new GoogleAuthProvider());
        await deleteUser(current);
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
