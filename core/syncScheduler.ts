// core/syncScheduler.ts
// Zero-dependency bridge between "a local record just changed" (the db layer)
// and "go sync it" (core/AutoSync.tsx). Kept in its own file with no imports so
// db.native.ts / db.web.ts can call notifyLocalChange() without pulling in
// Firebase (see the same split rationale in core/syncMerge.ts).
//
// ONLY locally-originated edits should call notifyLocalChange(). The
// applySynced* methods (records arriving FROM Firestore) must not, or a pull
// would immediately trigger another sync.

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called by the db layer after a user-driven write that sync should carry to other devices. */
export function notifyLocalChange(): void {
  for (const l of listeners) {
    try { l(); } catch { /* a bad listener must never break a save */ }
  }
}

/** Subscribe to local changes; returns the unsubscribe function. */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Shared "a sync is already running" flag - AutoSync and AccountScreen's
 *  manual "Sync Now" both honour it so two merges never overlap. */
export const syncGuard = { inFlight: false };
