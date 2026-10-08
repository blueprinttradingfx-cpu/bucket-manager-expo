// core/syncEngine.ts
// Phase 2 of sync-plan.md: one-way push ("Back Up Now"), local -> Firestore.
// Pure TypeScript, platform-agnostic - same code runs native + web since
// it's built on the plain `firebase` JS SDK rather than @react-native-firebase
// (see sync-plan.md §3).
//
// Deliberately NOT incremental: pushes the full local dataset on every call.
// This phase's job is validating schema + auth before any merge logic
// exists - dirty-tracking / an outbox is Phase 4 territory, deferred per
// sync-plan.md §5 (v1 scope is Phase 2 + 3 only).
//
// Firestore shape (sync-plan.md §2):
//   users/{uid}/buckets/{uuid}
//   users/{uid}/transactions/{uuid}
//   users/{uid}/watchlist/{ticker}
//   users/{uid}/settings/preferences

import { doc, writeBatch, getDoc, getDocs, collection } from 'firebase/firestore';
import { firestore } from './firebaseConfig';
import {
  SyncSnapshot, SyncSettingsRecord, BucketStoreAPI,
} from './storeApi';
import { PushableSnapshot, MergePlan, mergeSnapshots } from './syncMerge';

// Re-exported so nothing outside this file + syncMerge.ts needs to know
// mergeSnapshots lives in a separate, Firebase-free module (see
// syncMerge.ts's file header for why the split exists) - AccountScreen.tsx
// still imports everything Phase 2-4 needs from just './syncEngine'. Tests
// that need mergeSnapshots WITHOUT dragging in Firebase (test/run.ts)
// import directly from './syncMerge' instead - see that file's header.
export { PushableSnapshot, MergePlan, mergeSnapshots } from './syncMerge';

const BATCH_LIMIT = 450; // Firestore's hard cap is 500 writes/batch - leave headroom.

export interface PushResult {
  bucketsWritten: number;
  transactionsWritten: number;
  watchlistWritten: number;
  stockNotesWritten: number;
  stockTagsWritten: number;
  stockAlertsWritten: number;
  stockTrackerEntriesWritten: number;
  settingsWritten: boolean;
  pushedAt: string;
}

/** One-way push: local -> Firestore. Phase 2's "Back Up Now" always passes
 *  a full local snapshot (see file header: pushes everything, no dirty-
 *  tracking); Phase 4's "Sync Now" (applyMergePlan) passes just the
 *  toPush subset a merge decided on - same function either way. Chunks into
 *  multiple batches if the dataset exceeds Firestore's 500-writes-per-batch
 *  limit - unlikely for a personal portfolio, but cheap to handle correctly
 *  rather than assume it never happens. */
export async function pushSnapshotToFirestore(uid: string, snapshot: PushableSnapshot): Promise<PushResult> {
  const db = firestore;

  let batch = writeBatch(db);
  let opsInBatch = 0;
  const commits: Promise<void>[] = [];

  const stage = (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => {
    batch.set(ref, data, { merge: true });
    opsInBatch++;
    if (opsInBatch >= BATCH_LIMIT) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  };

  for (const b of snapshot.buckets) {
    stage(doc(db, 'users', uid, 'buckets', b.uuid), {
      name: b.name, yieldLow: b.yieldLow, yieldHigh: b.yieldHigh, color: b.color,
      sortOrder: b.sortOrder, updatedAt: b.updatedAt, deletedAt: b.deletedAt,
    });
  }
  for (const t of snapshot.transactions) {
    stage(doc(db, 'users', uid, 'transactions', t.uuid), {
      bucketUuid: t.bucketUuid, date: t.date, type: t.type, stock: t.stock,
      description: t.description, quantity: t.quantity, price: t.price, fees: t.fees,
      currency: t.currency, amount: t.amount, rowHash: t.rowHash, isManual: t.isManual,
      updatedAt: t.updatedAt, deletedAt: t.deletedAt,
    });
  }
  for (const w of snapshot.watchlist) {
    stage(doc(db, 'users', uid, 'watchlist', w.ticker), {
      buyBelowPrice: w.buyBelowPrice, addedAt: w.addedAt,
      updatedAt: w.updatedAt, deletedAt: w.deletedAt,
    });
  }
  for (const n of snapshot.stockNotes) {
    stage(doc(db, 'users', uid, 'stockNotes', n.uuid), {
      ticker: n.ticker, contentHtml: n.contentHtml, createdAt: n.createdAt,
      updatedAt: n.updatedAt, deletedAt: n.deletedAt,
    });
  }
  for (const t of snapshot.stockTags) {
    // Firestore doc id: ticker and tag joined by pipe. Neither component
    // contains a pipe (tags are always ASCII label-text), so this is a safe
    // composite key that stays human-readable in the console.
    const docId = `${t.ticker}|${t.tag.replace(/[/]/g, '_')}`;
    stage(doc(db, 'users', uid, 'stockTags', docId), {
      ticker: t.ticker, tag: t.tag,
      assignedAt: t.assignedAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt,
    });
  }
  for (const a of (snapshot.stockAlerts ?? [])) {
    stage(doc(db, 'users', uid, 'stockAlerts', a.id), {
      ticker: a.ticker, type: a.type, title: a.title,
      eventDate: a.eventDate ?? null, eventTime: a.eventTime ?? null,
      reminderTiming: a.reminderTiming ?? null,
      priceDirection: a.priceDirection ?? null, priceThreshold: a.priceThreshold ?? null,
      email: a.email, status: a.status,
      createdAt: a.createdAt, updatedAt: a.updatedAt, deletedAt: a.deletedAt ?? null,
      lastTriggeredAt: a.lastTriggeredAt ?? null,
      lastTriggeredValue: a.lastTriggeredValue != null ? String(a.lastTriggeredValue) : null,
      lastCheckedAt: a.lastCheckedAt ?? null,
    });
  }
  for (const e of (snapshot.stockTrackerEntries ?? [])) {
    stage(doc(db, 'users', uid, 'stockTracker', e.id), {
      ticker: e.ticker, areaPriceOfInterest: e.areaPriceOfInterest ?? '',
      weeklyMacdTrend: e.weeklyMacdTrend ?? 'none',
      weeklyMacdTrendCustom: e.weeklyMacdTrendCustom ?? null,
      foreignFlowSentiment: e.foreignFlowSentiment ?? 'unknown',
      eventCatalyst: e.eventCatalyst ?? '',
      eventDate: e.eventDate ?? null,
      eventAlertId: e.eventAlertId ?? null,
      projection: e.projection ?? '',
      notes: e.notes ?? null,
      priceAlertId: e.priceAlertId ?? null,
      createdAt: e.createdAt, updatedAt: e.updatedAt, deletedAt: e.deletedAt ?? null,
    });
  }
  if (snapshot.settings) {
    stage(doc(db, 'users', uid, 'settings', 'preferences'), {
      monthlyIncomeGoal: snapshot.settings.monthlyIncomeGoal,
      themeMode: snapshot.settings.themeMode,
      updatedAt: snapshot.settings.updatedAt,
    });
  }

  if (opsInBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  const pushedAt = new Date().toISOString();
  // Best-effort bookkeeping doc for a future "Last synced" display / Phase 3
  // restore - failure here shouldn't fail the backup itself, so it's a
  // separate try/catch rather than staged into the batches above.
  try {
    const metaBatch = writeBatch(db);
    metaBatch.set(doc(db, 'users', uid, 'meta', 'sync'), { lastPushedAt: pushedAt }, { merge: true });
    await metaBatch.commit();
  } catch {
    // non-fatal
  }

  return {
    bucketsWritten: snapshot.buckets.length,
    transactionsWritten: snapshot.transactions.length,
    watchlistWritten: snapshot.watchlist.length,
    stockNotesWritten: snapshot.stockNotes.length,
    stockTagsWritten: snapshot.stockTags.length,
    stockAlertsWritten: (snapshot.stockAlerts ?? []).length,
    stockTrackerEntriesWritten: (snapshot.stockTrackerEntries ?? []).length,
    settingsWritten: snapshot.settings != null,
    pushedAt,
  };
}

// --- Phase 3 of sync-plan.md: one-way pull, Firestore -> local -----------
// Fetches the cloud snapshot only - applying it locally (the "clean
// overwrite", not a merge - see sync-plan.md §5) is
// BucketStoreAPI.restoreFromSyncSnapshot(), same split as push: this file
// only knows Firestore, core/db.native.ts / db.web.ts only know their own
// storage. Read-only, so unlike pushSnapshotToFirestore there's no batching
// concern - Firestore reads aren't capped the way batched writes are.

/** doc.id IS the uuid/ticker for every collection here (see how
 *  pushSnapshotToFirestore names its docs) - never a separate field inside
 *  the doc data, so every mapper below pulls the key from d.id. */
export async function pullSnapshotFromFirestore(uid: string): Promise<SyncSnapshot | null> {
  const db = firestore;

  // settings/preferences is always staged by pushSnapshotToFirestore, even
  // on an otherwise-empty account (see the unconditional `stage(...settings...)`
  // call above) - so its existence is exactly "has this uid ever backed up",
  // the signal the caller needs to know whether there's anything to restore.
  const settingsSnap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
  if (!settingsSnap.exists()) return null;
  const settingsData = settingsSnap.data() as SyncSettingsRecord;

  const [bucketsSnap, txnsSnap, watchlistSnap, stockNotesSnap, stockTagsSnap, stockAlertsSnap, stockTrackerSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'buckets')),
    getDocs(collection(db, 'users', uid, 'transactions')),
    getDocs(collection(db, 'users', uid, 'watchlist')),
    getDocs(collection(db, 'users', uid, 'stockNotes')),
    getDocs(collection(db, 'users', uid, 'stockTags')),
    getDocs(collection(db, 'users', uid, 'stockAlerts')),
    getDocs(collection(db, 'users', uid, 'stockTracker')),
  ]);

  return {
    buckets: bucketsSnap.docs.map((d) => {
      const v = d.data();
      return {
        uuid: d.id, name: v.name, yieldLow: v.yieldLow ?? null, yieldHigh: v.yieldHigh ?? null,
        color: v.color ?? null, sortOrder: v.sortOrder ?? 0, updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    transactions: txnsSnap.docs.map((d) => {
      const v = d.data();
      return {
        uuid: d.id, bucketUuid: v.bucketUuid, date: v.date ?? null, type: v.type ?? null,
        stock: v.stock ?? null, description: v.description ?? null, quantity: v.quantity ?? null,
        price: v.price ?? null, fees: v.fees ?? null, currency: v.currency ?? null, amount: v.amount ?? null,
        rowHash: v.rowHash, isManual: !!v.isManual, updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    watchlist: watchlistSnap.docs.map((d) => {
      const v = d.data();
      return {
        ticker: d.id, buyBelowPrice: v.buyBelowPrice ?? null, addedAt: v.addedAt,
        updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    stockNotes: stockNotesSnap.docs.map((d) => {
      const v = d.data();
      return {
        uuid: d.id, ticker: v.ticker, contentHtml: v.contentHtml ?? '',
        createdAt: v.createdAt, updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    stockTags: stockTagsSnap.docs.map((d) => {
      const v = d.data();
      return {
        ticker: v.ticker, tag: v.tag,
        assignedAt: v.assignedAt ?? null,
        updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    stockAlerts: stockAlertsSnap.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id, ticker: v.ticker, type: v.type, title: v.title ?? '',
        eventDate: v.eventDate ?? null, eventTime: v.eventTime ?? null,
        reminderTiming: v.reminderTiming ?? null,
        priceDirection: v.priceDirection ?? null, priceThreshold: v.priceThreshold ?? null,
        email: v.email ?? '', status: v.status ?? 'active',
        createdAt: v.createdAt, updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
        lastTriggeredAt: v.lastTriggeredAt ?? null,
        lastTriggeredValue: v.lastTriggeredValue ?? null,
        lastCheckedAt: v.lastCheckedAt ?? null,
      };
    }),
    stockTrackerEntries: stockTrackerSnap.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id, ticker: v.ticker, areaPriceOfInterest: v.areaPriceOfInterest ?? '',
        weeklyMacdTrend: v.weeklyMacdTrend ?? 'none',
        weeklyMacdTrendCustom: v.weeklyMacdTrendCustom ?? null,
        foreignFlowSentiment: v.foreignFlowSentiment ?? 'unknown',
        eventCatalyst: v.eventCatalyst ?? '',
        eventDate: v.eventDate ?? null,
        eventAlertId: v.eventAlertId ?? null,
        projection: v.projection ?? '',
        notes: v.notes ?? null,
        priceAlertId: v.priceAlertId ?? null,
        createdAt: v.createdAt, updatedAt: v.updatedAt, deletedAt: v.deletedAt ?? null,
      };
    }),
    settings: {
      monthlyIncomeGoal: settingsData.monthlyIncomeGoal ?? null,
      themeMode: settingsData.themeMode ?? 'system',
      updatedAt: settingsData.updatedAt,
    },
  };
}

// --- Phase 4 of sync-plan.md: bidirectional merge -------------------------
// mergeSnapshots itself (the pure decision logic) now lives in
// core/syncMerge.ts - see that file's header for why. Everything below is
// pure I/O plumbing that carries out what a MergePlan says: applyMergePlan
// pushes/pulls, syncNow is the one entry point the UI calls.

export interface SyncResult {
  pushed: PushResult;
  pulled: { buckets: number; transactions: number; watchlist: number; stockNotes: number; stockTags: number; stockAlerts: number; stockTrackerEntries: number; settingsApplied: boolean; failures: number };
  syncedAt: string;
}

/** The I/O half: pushes toPush via pushSnapshotToFirestore (reused, not
 *  rebuilt - sync-plan.md §10b), then applies toPull locally via the
 *  BucketStoreAPI.applySynced* upsert methods - buckets before transactions,
 *  same ordering reason as restoreFromSyncSnapshot.
 *
 *  Per-record try/catch on the pull side (NOT a retry/offline queue -
 *  sync-plan.md §10c/§10e explicitly cut that): one record failing (e.g.
 *  the documented cross-device name-collision gap on applySyncedBucket)
 *  shouldn't abort every other record in the same sync. A record that fails
 *  here simply isn't applied locally, so it still shows as "remote newer"
 *  on the next sync and gets retried automatically - the merge is
 *  idempotent by construction, so this needs no separate bookkeeping. */
export async function applyMergePlan(store: BucketStoreAPI, uid: string, plan: MergePlan): Promise<SyncResult> {
  const pushed = await pushSnapshotToFirestore(uid, plan.toPush);

  let failures = 0;
  for (const b of plan.toPull.buckets) {
    try { await store.applySyncedBucket(b); } catch (e) { failures++; console.warn('[syncEngine] applySyncedBucket failed', b.uuid, e); }
  }
  for (const t of plan.toPull.transactions) {
    try { await store.applySyncedTransaction(t); } catch (e) { failures++; console.warn('[syncEngine] applySyncedTransaction failed', t.uuid, e); }
  }
  for (const w of plan.toPull.watchlist) {
    try { await store.applySyncedWatchlistItem(w); } catch (e) { failures++; console.warn('[syncEngine] applySyncedWatchlistItem failed', w.ticker, e); }
  }
  for (const n of plan.toPull.stockNotes) {
    try { await store.applySyncedStockNote(n); } catch (e) { failures++; console.warn('[syncEngine] applySyncedStockNote failed', n.uuid, e); }
  }
  for (const t of plan.toPull.stockTags) {
    try { await store.applySyncedTag(t); } catch (e) { failures++; console.warn('[syncEngine] applySyncedTag failed', t.ticker, t.tag, e); }
  }
  for (const a of (plan.toPull.stockAlerts ?? [])) {
    try { await store.applySyncedStockAlert(a); } catch (e) { failures++; console.warn('[syncEngine] applySyncedStockAlert failed', a.id, e); }
  }
  for (const e of (plan.toPull.stockTrackerEntries ?? [])) {
    try { await store.applySyncedStockTrackerEntry(e); } catch (err) { failures++; console.warn('[syncEngine] applySyncedStockTrackerEntry failed', e.id, err); }
  }
  if (plan.toPull.settings) {
    try { await store.applySyncedSettings(plan.toPull.settings); } catch (e) { failures++; console.warn('[syncEngine] applySyncedSettings failed', e); }
  }

  return {
    pushed,
    pulled: {
      buckets: plan.toPull.buckets.length,
      transactions: plan.toPull.transactions.length,
      watchlist: plan.toPull.watchlist.length,
      stockNotes: plan.toPull.stockNotes.length,
      stockTags: plan.toPull.stockTags.length,
      stockAlerts: (plan.toPull.stockAlerts ?? []).length,
      stockTrackerEntries: (plan.toPull.stockTrackerEntries ?? []).length,
      settingsApplied: !!plan.toPull.settings,
      failures,
    },
    syncedAt: pushed.pushedAt,
  };
}

/** One call for the UI (AccountScreen's "Sync Now", sync-plan.md §10d):
 *  fetch both sides, decide the plan, apply it. Does NOT call
 *  store.setLastSyncedAt() itself - same "only after success" rule Phase 2
 *  already established for getLastSyncedAt/setLastSyncedAt, left to the
 *  caller so a UI-layer failure after this resolves doesn't falsely record
 *  a successful sync. */
export async function syncNow(store: BucketStoreAPI, uid: string): Promise<SyncResult> {
  const [local, remote] = await Promise.all([
    store.getSyncSnapshot(),
    pullSnapshotFromFirestore(uid),
  ]);
  const plan = mergeSnapshots(local, remote);
  return applyMergePlan(store, uid, plan);
}

// --- Account deletion (pre-launch pass, 2026-07-26) -----------------------
// The Firestore client SDK has no recursive-delete - deleting the users/{uid}
// document itself would NOT delete its subcollections (buckets/transactions/
// watchlist/stockNotes/settings/meta), leaving orphaned data behind under a
// uid nobody can read anymore (firestore.rules scopes every doc to its own
// uid, so even the developer can't clean it up later through the client SDK
// - it'd need the Admin SDK/console). So this enumerates and deletes every
// doc in every subcollection explicitly, same batching approach as
// pushSnapshotToFirestore (450-op headroom under Firestore's 500/batch cap).
export async function deleteAllRemoteData(uid: string): Promise<void> {
  const db = firestore;

  const [bucketsSnap, txnsSnap, watchlistSnap, stockNotesSnap, stockTagsSnap, stockAlertsSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'buckets')),
    getDocs(collection(db, 'users', uid, 'transactions')),
    getDocs(collection(db, 'users', uid, 'watchlist')),
    getDocs(collection(db, 'users', uid, 'stockNotes')),
    getDocs(collection(db, 'users', uid, 'stockTags')),
    getDocs(collection(db, 'users', uid, 'stockAlerts')),
  ]);

  let batch = writeBatch(db);
  let opsInBatch = 0;
  const commits: Promise<void>[] = [];

  const stageDelete = (ref: ReturnType<typeof doc>) => {
    batch.delete(ref);
    opsInBatch++;
    if (opsInBatch >= BATCH_LIMIT) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  };

  for (const d of bucketsSnap.docs) stageDelete(d.ref);
  for (const d of txnsSnap.docs) stageDelete(d.ref);
  for (const d of watchlistSnap.docs) stageDelete(d.ref);
  for (const d of stockNotesSnap.docs) stageDelete(d.ref);
  for (const d of stockTagsSnap.docs) stageDelete(d.ref);
  for (const d of stockAlertsSnap.docs) stageDelete(d.ref);
  // Single-doc collections - settings/preferences and meta/sync - staged
  // the same way rather than a bare deleteDoc, so they ride along in the
  // batch instead of firing as separate round trips.
  stageDelete(doc(db, 'users', uid, 'settings', 'preferences'));
  stageDelete(doc(db, 'users', uid, 'meta', 'sync'));

  if (opsInBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);
}
