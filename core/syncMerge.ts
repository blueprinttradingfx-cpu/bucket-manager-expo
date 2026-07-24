// core/syncMerge.ts
// Phase 4 of sync-plan.md (§10b): the PURE decision logic for bidirectional
// merge - union-of-keys, last-write-wins-by-updatedAt. Deliberately split
// out of core/syncEngine.ts into its own module with ZERO Firebase imports:
// syncEngine.ts imports firebaseConfig.ts, which reads Constants.expoConfig
// at module scope and THROWS if Firebase isn't configured yet - which meant
// mergeSnapshots (despite being pure, no I/O) couldn't be unit-tested via
// ts-node without a full Expo/Firebase environment. This file has no such
// import, so test/run.ts can exercise it directly with hand-built snapshots
// (see test/run.ts Scenario 4) the same way it already tests
// core/bucketLogic.ts's pure functions.
//
// core/syncEngine.ts re-exports everything here, so nothing outside this
// file + syncEngine.ts needs to know the split exists - AccountScreen.tsx
// etc. still import everything Phase 2-4 needs from just './syncEngine'.

import {
  SyncSnapshot, SyncBucketRecord, SyncTransactionRecord, SyncWatchlistRecord, SyncSettingsRecord,
} from './storeApi';

/** Shape pushSnapshotToFirestore actually needs - a full SyncSnapshot
 *  satisfies this, but Phase 4's merge-push (see applyMergePlan in
 *  syncEngine.ts) only has a partial one: an arbitrary subset of
 *  buckets/transactions/watchlist, and settings is null whenever the OTHER
 *  side's settings won the LWW compare (pushing local settings in that case
 *  would stomp a newer remote value with a stale one - see mergeSnapshots).
 *  null skips staging the settings doc for that call entirely, leaving
 *  Firestore's copy untouched. */
export interface PushableSnapshot {
  buckets: SyncBucketRecord[];
  transactions: SyncTransactionRecord[];
  watchlist: SyncWatchlistRecord[];
  settings: SyncSettingsRecord | null;
}

export interface MergePlan {
  toPush: PushableSnapshot;
  toPull: PushableSnapshot;
}

/** Union-of-keys, last-write-wins-by-updatedAt compare for one uuid/ticker-
 *  keyed collection. A tombstone (deletedAt set) is just a record like any
 *  other here - if it has the newer updatedAt it wins the whole record,
 *  which is what makes "delete on one device, edit on another" resolve the
 *  same way as an ordinary field-edit conflict (sync-plan.md §10b). Equal
 *  updatedAt (only possible if both sides already hold the identical
 *  record - e.g. nothing changed since the last sync) needs no action
 *  either way. */
function diffByKey<T extends { updatedAt: string }>(
  local: Map<string, T>, remote: Map<string, T>
): { toPush: T[]; toPull: T[] } {
  const toPush: T[] = [];
  const toPull: T[] = [];
  const allKeys = new Set<string>([...local.keys(), ...remote.keys()]);
  for (const key of allKeys) {
    const l = local.get(key);
    const r = remote.get(key);
    if (l && !r) { toPush.push(l); continue; }
    if (r && !l) { toPull.push(r); continue; }
    if (l && r) {
      // ISO-8601 timestamps (always produced via Date.toISOString() on both
      // platforms - see db.native.ts/db.web.ts) compare correctly as plain
      // strings, no Date parsing needed.
      if (l.updatedAt > r.updatedAt) toPush.push(l);
      else if (r.updatedAt > l.updatedAt) toPull.push(r);
    }
  }
  return { toPush, toPull };
}

/** Decides what needs to move which way - does NOT talk to Firestore or
 *  local storage itself (see applyMergePlan in syncEngine.ts for the I/O
 *  half). `remote === null` (this uid has never backed up - see
 *  pullSnapshotFromFirestore's doc comment) is treated as an empty remote:
 *  everything local pushes, nothing pulls - the same outcome as Phase 2's
 *  first "Back Up Now". */
export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot | null): MergePlan {
  if (!remote) {
    return {
      toPush: { buckets: local.buckets, transactions: local.transactions, watchlist: local.watchlist, settings: local.settings },
      toPull: { buckets: [], transactions: [], watchlist: [], settings: null },
    };
  }

  const buckets = diffByKey(
    new Map(local.buckets.map((b) => [b.uuid, b])),
    new Map(remote.buckets.map((b) => [b.uuid, b]))
  );
  const transactions = diffByKey(
    new Map(local.transactions.map((t) => [t.uuid, t])),
    new Map(remote.transactions.map((t) => [t.uuid, t]))
  );
  const watchlist = diffByKey(
    new Map(local.watchlist.map((w) => [w.ticker, w])),
    new Map(remote.watchlist.map((w) => [w.ticker, w]))
  );

  // Settings is a single record, not a uuid-keyed collection (sync-plan.md
  // §10b) - whole-record LWW compare, same rule as everything else, just
  // without the union-of-keys step since there's only ever one key.
  let pushSettings: SyncSettingsRecord | null = null;
  let pullSettings: SyncSettingsRecord | null = null;
  if (local.settings.updatedAt > remote.settings.updatedAt) pushSettings = local.settings;
  else if (remote.settings.updatedAt > local.settings.updatedAt) pullSettings = remote.settings;

  return {
    toPush: { buckets: buckets.toPush, transactions: transactions.toPush, watchlist: watchlist.toPush, settings: pushSettings },
    toPull: { buckets: buckets.toPull, transactions: transactions.toPull, watchlist: watchlist.toPull, settings: pullSettings },
  };
}
