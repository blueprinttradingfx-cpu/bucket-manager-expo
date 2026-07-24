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
}
