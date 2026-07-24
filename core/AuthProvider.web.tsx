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
} from 'firebase/auth';
import { auth } from './firebaseAuth';
import { AuthContextValue, AuthUser } from './authTypes';

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
  }), [user, initializing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
