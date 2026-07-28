// core/authTypes.ts
// The minimal profile shape screens actually need - AccountScreen and
// SettingsScreen read this, not the full Firebase User object, so neither
// screen needs to import anything Firebase-specific. uid is what Phase 2/3
// will use to scope Firestore documents (sync-plan.md §2's
// users/{uid}/... paths).

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface AuthContextValue {
  /** null while the initial auth-state check is still in flight, so
   *  screens can tell "not signed in" apart from "don't know yet" and
   *  avoid a sign-in-button flash for someone who's actually signed in. */
  user: AuthUser | null;
  initializing: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Deletes the signed-in Firebase Auth account itself (pre-launch pass,
   *  2026-07-26). Firestore data is NOT this method's job - callers should
   *  run core/syncEngine.ts's deleteAllRemoteData(uid) and
   *  store.wipeAllLocalData() alongside this, since deleting the auth
   *  account doesn't touch either. Firebase requires a "recent" login for
   *  this operation (throws `auth/requires-recent-login` otherwise) -
   *  implementations transparently re-prompt sign-in and retry once rather
   *  than surfacing that as an error the caller has to handle itself. */
  deleteAccount: () => Promise<void>;
}
