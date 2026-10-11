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
// The automatic triggers for (2) (sign-in, app foreground, and shortly after a
// local alert/tracker edit) live in core/AutoSync.tsx, mounted once at the app
// root - they used to live HERE, which meant nothing synced unless this screen
// happened to be open. AutoSync waits for (1) to have resolved
// (getHasCompletedInitialRestore()) before firing, so the two never race.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Alert from '../core/alert';
import { useAuth } from '../core/AuthProvider';
import { useStore } from '../core/StoreProvider';
import { pullSnapshotFromFirestore, syncNow, deleteAllRemoteData, SyncResult } from '../core/syncEngine';
import { SyncSnapshot } from '../core/storeApi';
import { syncGuard } from '../core/syncScheduler';
import { useThemeColors } from '../core/ThemeContext';
import { spacing, radii, fonts, centeredContent, ThemeColors } from '../core/theme';
import { useScreenViewLog } from '../core/useScreenViewLog';


export default function AccountScreen() {
  useScreenViewLog('Account');
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, initializing, signInWithGoogle, signOut, deleteAccount } = useAuth();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Guards against the manual button and the root-level AutoSync (core/AutoSync.tsx)
  // running at the same time - shared via syncGuard, not a full queue, just
  // "don't start a second sync while one's in flight."

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
          `${result.watchlistWritten} watchlist ticker${result.watchlistWritten === 1 ? '' : 's'} · ` +
          `${result.stockNotesWritten} note${result.stockNotesWritten === 1 ? '' : 's'} restored.`
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

  // Pre-launch pass (2026-07-26): remote-then-local-then-account, in that
  // specific order, so a failure partway through can never leave local data
  // wiped while a remote copy (or the account itself) still exists -
  // there's always something left to retry against. deleteAccount() runs
  // last on purpose: once it succeeds the Firebase session is gone, so any
  // step that still needs auth (deleteAllRemoteData, which Firestore rules
  // scope to request.auth.uid) has to happen before it, not after.
  const handleDeleteAccount = async () => {
    if (!user) return;
    Alert.alert(
      'Delete your data?',
      "This permanently deletes your synced data, your account, and this device's local data. " +
      "This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAllRemoteData(user.uid);
              await store.wipeAllLocalData();
              await deleteAccount();
              Alert.alert('Deleted', 'Your data and account have been deleted.');
            } catch (e: any) {
              console.warn('[AccountScreen] delete account failed', e);
              Alert.alert(
                'Delete failed',
                e?.message ?? "Something went wrong partway through. It's safe to try again - Delete Everything " +
                'can be retried and will pick up wherever it left off.'
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  // Phase 4 (sync-plan.md §10): bidirectional merge, replacing Phase 2's
  // push-only "Back Up Now" - fetches both sides, resolves per-record via
  // last-write-wins, pushes what's locally newer and pulls what's remotely
  // newer, in one round trip. setLastSyncedAt only runs after success,
  // same "don't claim success on failure" rule Phase 2 established.
  const summarizeResult = (result: SyncResult) => {
    const sent = `${result.pushed.bucketsWritten} bucket${result.pushed.bucketsWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.transactionsWritten} transaction${result.pushed.transactionsWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.watchlistWritten} watchlist ticker${result.pushed.watchlistWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.stockNotesWritten} note${result.pushed.stockNotesWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.stockAlertsWritten} alert${result.pushed.stockAlertsWritten === 1 ? '' : 's'} · ` +
      `${result.pushed.stockTrackerEntriesWritten} tracker entr${result.pushed.stockTrackerEntriesWritten === 1 ? 'y' : 'ies'}`;
    const received = `${result.pulled.buckets} bucket${result.pulled.buckets === 1 ? '' : 's'} · ` +
      `${result.pulled.transactions} transaction${result.pulled.transactions === 1 ? '' : 's'} · ` +
      `${result.pulled.watchlist} watchlist ticker${result.pulled.watchlist === 1 ? '' : 's'} · ` +
      `${result.pulled.stockNotes} note${result.pulled.stockNotes === 1 ? '' : 's'} · ` +
      `${result.pulled.stockAlerts} alert${result.pulled.stockAlerts === 1 ? '' : 's'} · ` +
      `${result.pulled.stockTrackerEntries} tracker entr${result.pulled.stockTrackerEntries === 1 ? 'y' : 'ies'}`;
    const failureNote = result.pulled.failures > 0
      ? `\n\n${result.pulled.failures} record${result.pulled.failures === 1 ? '' : 's'} couldn't be applied - will retry next sync.`
      : '';
    return `Sent: ${sent}\nReceived: ${received}${failureNote}`;
  };

  // Shown under the Sync complete summary: what each side held before the merge, and which
  // Firebase project + account ID this device is talking to. If the Firestore console (or the
  // alert emails) disagree with the app, this is where the mismatch shows up.
  const formatDiagnostics = (d?: SyncResult['diagnostics']) => {
    if (!d) return '';
    const fmt = (c: NonNullable<SyncResult['diagnostics']>['local']) =>
      `${c.buckets} buckets · ${c.transactions} transactions · ${c.watchlist} watchlist · ${c.notes} notes · ` +
      `${c.alerts} alerts · ${c.trackerEntries} tracker entries`;
    return `\n\nBefore this sync:\nOn this device: ${fmt(d.local)}\nIn the cloud: ${d.remote ? fmt(d.remote) : 'nothing yet'}` +
      `\n\nFirebase project: ${d.projectId}\nAccount ID: ${d.uid}`;
  };

  const handleSyncNow = async () => {
    if (!user || syncGuard.inFlight) return;
    syncGuard.inFlight = true;
    setSyncing(true);
    try {
      const result = await syncNow(store, user.uid);
      await store.setLastSyncedAt(result.syncedAt);
      setLastSyncedAt(result.syncedAt);
      Alert.alert('Sync complete', summarizeResult(result) + formatDiagnostics(result.diagnostics));
    } catch (e: any) {
      console.warn('[AccountScreen] syncNow failed', e);
      Alert.alert('Sync failed', e?.message ?? 'Check your connection and try again.');
    } finally {
      setSyncing(false);
      syncGuard.inFlight = false;
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
            style={[styles.button, (busy || syncing || restoring || deleting) && styles.buttonDisabled]}
            onPress={handleSyncNow}
            disabled={busy || syncing || restoring || deleting}
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
            style={[styles.button, styles.buttonSecondary, styles.buttonSpaced, (busy || syncing || restoring || deleting) && styles.buttonDisabled]}
            onPress={handleSignOut}
            disabled={busy || syncing || restoring || deleting}
          >
            {busy
              ? <ActivityIndicator color={colors.onSurface} />
              : <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Sign Out</Text>}
          </Pressable>

          <Text style={styles.dangerZoneLabel}>Danger zone</Text>
          <Pressable
            style={[styles.button, styles.buttonDanger, (busy || syncing || restoring || deleting) && styles.buttonDisabled]}
            onPress={handleDeleteAccount}
            disabled={busy || syncing || restoring || deleting}
          >
            {deleting
              ? <ActivityIndicator color={colors.error} />
              : <Text style={[styles.buttonText, styles.buttonTextDanger]}>Delete My Data</Text>}
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
  dangerZoneLabel: {
    fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.error },
  buttonTextDanger: { color: colors.error },
});
