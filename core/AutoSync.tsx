// core/AutoSync.tsx
// Mounted once at the app root (App.tsx, inside AuthProvider) so sync no longer
// depends on the Account screen being open. Before this, the foreground
// auto-sync lived inside AccountScreen and only ran while that screen was
// mounted - so alerts/tracker entries saved on one device were never pushed,
// and other devices never pulled them, unless "Sync Now" was tapped by hand.
//
// Triggers (all silent; syncNow's per-record LWW merge is idempotent, so a
// failed or repeated run is harmless - see sync-plan.md §10e):
//   1. A signed-in user appears / the app mounts with a persisted session.
//   2. The app returns to the foreground (throttled).
//   3. A few seconds after a local alert/tracker change (debounced), so what
//      you just saved reaches the cloud without waiting for a foreground event.
//
// It waits for the Phase 3 first-login restore (still in AccountScreen) to have
// been decided on this device before it ever syncs, same rule the old
// AccountScreen auto-trigger followed.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthProvider';
import { useStore } from './StoreProvider';
import { syncNow } from './syncEngine';
import { onLocalChange, syncGuard } from './syncScheduler';

/** Foreground triggers are throttled so rapid app-switching doesn't hammer Firestore. */
const FOREGROUND_THROTTLE_MS = 2 * 60 * 1000;
/** Wait this long after the LAST local edit before pushing, so a burst of edits is one sync. */
const LOCAL_CHANGE_DEBOUNCE_MS = 4000;

export default function AutoSync(): null {
  const { user } = useAuth();
  const store = useStore();
  const lastRunRef = useRef(0);
  const rerunRef = useRef(false); // a change landed while a sync was already running

  useEffect(() => {
    if (!user) return;
    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (disposed) return;
      if (syncGuard.inFlight) { rerunRef.current = true; return; }
      const handled = await store.getHasCompletedInitialRestore().catch(() => false);
      if (!handled || disposed) return;

      syncGuard.inFlight = true;
      lastRunRef.current = Date.now();
      try {
        const result = await syncNow(store, user.uid);
        await store.setLastSyncedAt(result.syncedAt);
      } catch (e) {
        console.warn('[AutoSync] sync failed (silent; retries on next trigger)', e);
      } finally {
        syncGuard.inFlight = false;
      }
      if (rerunRef.current && !disposed) {
        rerunRef.current = false;
        run();
      }
    };

    const runIfStale = () => {
      if (Date.now() - lastRunRef.current < FOREGROUND_THROTTLE_MS) return;
      run();
    };

    // 1. Sign-in / app launch with a persisted session.
    runIfStale();

    // 2. Back to foreground.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runIfStale();
    });

    // 3. A local alert/tracker edit just happened.
    const offLocal = onLocalChange(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { run(); }, LOCAL_CHANGE_DEBOUNCE_MS);
    });

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      appStateSub.remove();
      offLocal();
    };
  }, [user, store]);

  return null;
}
