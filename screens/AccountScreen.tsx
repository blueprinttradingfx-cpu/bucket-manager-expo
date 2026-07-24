// screens/AccountScreen.tsx
// Sync-plan.md Phase 1-4: the one screen that needs a signed-in uid. Signed
// out: a single "Sign in with Google" button. Signed in: profile summary +
// last-synced time + "Sync Now" + "Sign out". Deliberately not gating the
// rest of the app behind sign-in - the app is fully useful offline/local-
// only, sync is opt-in, not a login wall.
//
// Two sync mechanisms coexist here, kept deliberately separate rather than
// merged into one code path:
//
// 1. The Phase 3 first-login restore check (§5/§8) - runs ONCE per device,
//    the first time a signed-in user shows up (store.getHasCompletedInitialRestore()
//    gates it). If local is empty it silently pulls; if local already has
//    data it asks first via Alert. This is a clean overwrite, not a merge -
//    still the right tool for "brand new device, nothing here yet."
// 2. Phase 4's bidirectional "Sync Now" (§10) - a per-record LWW merge,
//    safe to run repeatedly without asking, since (unlike a clean-overwrite
//    restore) it can never silently discard a local-only change - a record
//    only moves if the OTHER side's updatedAt is newer.
//
// The AppState foreground auto-trigger for (2) deliberately waits for (1)
// to have already resolved (checks getHasCompletedInitialRestore() before
// firing) so the two never race on the same first-launch mount.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Alert from '../core/alert';
import { useAuth } from '../core/AuthProvider';
import { useStore } from '../core/StoreProvider';
import { pullSnapshotFromFirestore, syncNow, SyncResult } from '../core/syncEngine';
import { SyncSnapshot } from '../core/storeApi';
import { useThemeColors } from '../core/ThemeContext';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useScreenViewLog } from '../core/useScreenViewLog';

// sync-plan.md §10d: manual tap always runs; the foreground auto-trigger is
// throttled so repeated app-foregrounding doesn't hammer Firestore.
const AUTO_SYNC_THROTTLE_MS = 15 * 60 * 1000;

export default function AccountScreen() {
  useScreenViewLog('Account');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, initializing, signInWithGoogle, signOut } = useAuth();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Guards against the manual button and the AppState auto-trigger firing
  // at the same time - not a full queue, just "don't start a second sync
  // while one's in flight."
  const syncInFlightRef = useRef(false);
  const lastAutoSyncRef = useRef(0);

  // Local "last backed up" bookkeeping is independent of auth state (it's
  // set by a completed push, not by signing in), so load it whenever a
  // signed-in user shows up - covers both "just signed in" and "screen
  // remounted while already signed in."
  useEffect(() => {
    if (!user) return;
    store.getLastSyncedAt().then(setLastSyncedAt).catch(() => {});
  }, [user, store]);

  // Phase 3 (sync-plan.md §5/§8): runs once per device, the first time a
  // signed-in user shows up here - not a repeatable button, since a
  // repeatable pull with no merge logic would clobber local-only changes.
  // getHasCompletedInitialRestore() gates it so every later screen visit or
  // app launch (onAuthStateChanged fires again on a persisted session) is a
  // no-op once this has been decided one way or the other.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const finishWithoutRestoring = async () => {
      await store.setHasCompletedInitialRestore(true).catch(() => {});
    };

    const runRestore = async (snapshot: SyncSnapshot) => {
      setRestoring(true);
      try {
        const result = await store.restoreFromSyncSnapshot(snapshot);
        if (cancelled) return;
        await store.setHasCompletedInitialRestore(true);
        Alert.alert(
          'Restore complete',
          `${result.bucketsWritten} bucket${result.bucketsWritten === 1 ? '' : 's'} · ` +
          `${result.transactionsWritten} transaction${result.transactionsWritten === 1 ? '' : 's'} · ` +
          `${result.watchlistWritten} watchlist ticker${result.watchlistWritten === 1 ? '' : 's'} restored.`
        );
      } catch (e: any) {
        console.warn('[AccountScreen] initial restore failed', e);
        if (!cancelled) {
          Alert.alert('Restore failed', e?.message ?? "Check your connection - we'll try again next time.");
        }
        // Deliberately NOT marking hasCompletedInitialRestore here - same
        // "don't claim success on failure" rule handleSyncNow follows for
        // setLastSyncedAt. A failed restore (e.g. offline) retries next
        // time this screen loads with this account signed in.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };

    (async () => {
      const alreadyHandled = await store.getHasCompletedInitialRestore();
      if (alreadyHandled || cancelled) return;

      const snapshot = await pullSnapshotFromFirestore(user.uid).catch(() => null);
      if (cancelled) return;
      if (!snapshot) {
        // Either this account has never backed anything up, or the pull
        // itself failed - either way there's nothing to silently apply.
        // Don't keep nagging on every launch waiting for a backup that may
        // never come; "Back Up Now" on this same screen creates one.
        await finishWithoutRestoring();
        return;
      }

      const hasLocalData = await store.hasAnyLocalData();
      if (cancelled) return;

      if (!hasLocalData) {
        await runRestore(snapshot);
        return;
      }

      Alert.alert(
        'Restore your data?',
        'Found a backup from another device. Restoring will replace the buckets, transactions, and ' +
        'watchlist on this device with that backup.',
        [
          { text: 'Not Now', style: 'cancel', onPress: () => { finishWithoutRestoring(); } },
          { text: 'Restore', style: 'destructive', onPress: () => { runRestore(snapshot); } },
        ]
      );
    })();

    return () => { cancelled = true; };
  }, [user, store]);

  // Phase 4d (sync-plan.md §10d/§11): bidirectional sync on app foreground,
  // throttled - NOT a recurring background timer (sync-plan.md §5 settled
  // "foreground-only, manual"; §10's opening note reconciles the doc's
  // stale "periodic" language with that). Waits for the Phase 3 effect
  // above to have already resolved before ever firing, so a first-launch
  // mount can't trigger both at once.
  useEffect(() => {
    if (!user) return;

    const trigger = async () => {
      if (syncInFlightRef.current) return;
      const handled = await store.getHasCompletedInitialRestore().catch(() => false);
      if (!handled) return;
      const now = Date.now();
      if (now - lastAutoSyncRef.current < AUTO_SYNC_THROTTLE_MS) return;
      lastAutoSyncRef.current = now;
      // Silent - no Alert here, unlike the manual button below. A failure
      // just means it retries next foreground or manual tap; syncNow's
      // merge is idempotent by construction (sync-plan.md §10e), so there's
      // nothing to lose by staying quiet about a transient failure.
      syncInFlightRef.current = true;
      try {
        const result = await syncNow(store, user.uid);
        await store.setLastSyncedAt(result.syncedAt);
        setLastSyncedAt(result.syncedAt);
      } catch (e) {
        console.warn('[AccountScreen] auto-sync failed (silent, no Alert by design)', e);
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') trigger();
    });
    return () => sub.remove();
  }, [user, store]);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message ?? 'Something went wrong signing in.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert('Sign-out failed', e?.message ?? 'Something went wrong signing out.');
    } finally {
      setBusy(false);
    }
  };

  // Phase 4 (sync-plan.md §10): bidirectional merge, replacing Phase 2's
  // push-only "Back Up Now" - fetches both sides, resolves per-record via
  // last-write-wins, pushes what's locally newer and pulls what's remotely
  // newer, in one round trip. setLastSyncedAt only runs after success,
  // same "don't claim success on failure" rule Phase 2 established.
  const summarizeResult = (result: SyncResult) => {
    const sent = `${result.pushed.bucketsWritten} bucket${result.pushed.bucketsWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.transactionsWritten} transaction${result.pushed.transactionsWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.watchlistWritten} watchlist ticker${result.pushed.watchlistWritten === 1 ? '' : 's'}`;
    const received = `${result.pulled.buckets} bucket${result.pulled.buckets === 1 ? '' : 's'} · ` +
      `${result.pulled.transactions} transaction${result.pulled.transactions === 1 ? '' : 's'} · ` +
      `${result.pulled.watchlist} watchlist ticker${result.pulled.watchlist === 1 ? '' : 's'}`;
    const failureNote = result.pulled.failures > 0
      ? `\n\n${result.pulled.failures} record${result.pulled.failures === 1 ? '' : 's'} couldn't be applied - will retry next sync.`
      : '';
    return `Sent: ${sent}\nReceived: ${received}${failureNote}`;
  };

  const handleSyncNow = async () => {
    if (!user || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setSyncing(true);
    try {
      const result = await syncNow(store, user.uid);
      lastAutoSyncRef.current = Date.now(); // the manual tap counts toward the auto-trigger throttle too
      await store.setLastSyncedAt(result.syncedAt);
      setLastSyncedAt(result.syncedAt);
      Alert.alert('Sync complete', summarizeResult(result));
    } catch (e: any) {
      console.warn('[AccountScreen] syncNow failed', e);
      Alert.alert('Sync failed', e?.message ?? 'Check your connection and try again.');
    } finally {
      setSyncing(false);
      syncInFlightRef.current = false;
    }
  };

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>Account</Text>
      <Text style={styles.hint}>
        Signing in keeps your buckets, transactions, and watchlist in sync across devices. The app
        works fully offline without this - it's only needed for sync.
      </Text>

      {user ? (
        <View style={styles.card}>
          <View style={styles.profileRow}>
            {user.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={22} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{user.displayName ?? 'Signed in'}</Text>
              {user.email && <Text style={styles.profileEmail}>{user.email}</Text>}
            </View>
          </View>

          <Text style={styles.lastSyncedText}>
            {lastSyncedAt
              ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
              : 'Never synced yet'}
          </Text>

          {restoring && (
            <View style={styles.restoringRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.restoringText}>Restoring your data…</Text>
            </View>
          )}

          <Pressable
            style={[styles.button, (busy || syncing || restoring) && styles.buttonDisabled]}
            onPress={handleSyncNow}
            disabled={busy || syncing || restoring}
          >
            {syncing
              ? <ActivityIndicator color={colors.onPrimary} />
              : (
                <View style={styles.signInRow}>
                  <Ionicons name="sync-outline" size={18} color={colors.onPrimary} />
                  <Text style={styles.buttonText}>Sync Now</Text>
                </View>
              )}
          </Pressable>

          <Pressable
            style={[styles.button, styles.buttonSecondary, styles.buttonSpaced, (busy || syncing || restoring) && styles.buttonDisabled]}
            onPress={handleSignOut}
            disabled={busy || syncing || restoring}
          >
            {busy
              ? <ActivityIndicator color={colors.onSurface} />
              : <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Sign Out</Text>}
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color={colors.onPrimary} />
              : (
                <View style={styles.signInRow}>
                  <Ionicons name="logo-google" size={18} color={colors.onPrimary} />
                  <Text style={styles.buttonText}>Sign in with Google</Text>
                </View>
              )}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, ...centeredContent },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, lineHeight: 19, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.outlineVariant,
    padding: spacing.md,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: radii.full },
  avatarFallback: { backgroundColor: colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' },
  profileName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.onSurface },
  profileEmail: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, marginTop: 2 },
  lastSyncedText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  restoringRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  restoringText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant },
  signInRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center' },
  buttonSpaced: { marginTop: spacing.sm },
  buttonSecondary: { backgroundColor: colors.surfaceVariant },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.bodyBold, color: colors.onPrimary, fontSize: 15 },
  buttonTextSecondary: { color: colors.onSurface },
});
