// test/run.web.ts
// Tests db.web.ts (the ACTUAL IndexedDB implementation, not a simulation of
// it) using fake-indexeddb to provide a real IndexedDB in Node. This is a
// stronger test than test/run.ts's FakeBucketStore, which only exercised
// the pure logic - this exercises the real storage code path, including
// the compound-index dedup lookup.
//
// Now imports the REAL production parsing code (xlsxRows.ts) instead of a
// separate reimplementation - this file used to have its own duplicate
// date-parsing logic, the same class of bug that caused a real,
// previously-undetected date-parsing bug in the actual import code.

import 'fake-indexeddb/auto'; // must be imported before core/db.web
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { RawRow } from '../core/bucketLogic';
import { rowsFromWorkbook } from '../core/xlsxRows';
import { WebBucketStore } from '../core/db.web';
import { SyncSnapshot } from '../core/storeApi';

// Portable path (path.join handles Windows \ vs Unix / automatically).
// Place your sample export at: <project root>/user-data/uploads/<filename>
const SAMPLE_FILE = path.join(
  __dirname, '..', 'user-data', 'uploads', 'Transactions-Jul_1__2026__8_33_15_PM.xlsx'
);

function loadRows(filePath: string): RawRow[] {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return rowsFromWorkbook(workbook);
}

async function main() {
  const allRows = loadRows(SAMPLE_FILE);
  const store = await WebBucketStore.create();

  console.log('=== Scenario 1: first import (Bucket 5) ===');
  console.log(await store.importIntoBucket('Bucket 5', allRows));

  console.log('\n=== Scenario 2: accidental exact re-import ===');
  console.log(await store.importIntoBucket('Bucket 5', allRows));

  console.log('\n=== Scenario 3: fresh export, 8 overlapping + 2 new ===');
  const overlap = allRows.slice(-8);
  const fresh: RawRow[] = [
    ...overlap,
    { Date: '05/02/2026', Type: 'BUY', Stock: 'MER', Description: 'MANILA ELECTRIC COMPANY',
      Quantity: 50, Price: 420.0, 'Comm & Other Fees': 61.95, Currency: 'PHP', Amount: -21061.95 },
    { Date: '06/02/2026', Type: 'CASH DIVIDEND', Stock: 'MREIT', Description: 'MREIT INC.',
      Quantity: 200, Price: 0.35, 'Comm & Other Fees': null, Currency: 'PHP', Amount: 70.0 },
  ];
  console.log(await store.importIntoBucket('Bucket 5', fresh));

  console.log('\n=== Scenario 4: multi-bucket isolation (a second, separate bucket) ===');
  console.log(await store.importIntoBucket('Bucket 3', allRows.slice(0, 5)));

  console.log('\n=== Aggregated holdings across ALL buckets (getAllHoldings) ===');
  const all = await store.getAllHoldings();
  console.table(all);

  console.log('\n=== Bucket 5 only (getBucketHoldings) ===');
  const { holdings, orphanSells } = await store.getBucketHoldings('Bucket 5');
  console.table(holdings);
  console.log('Orphan sells:', orphanSells.map((o) => o.Stock));

  console.log('\n=== Scenario 5: sync snapshot (Phase 2) ===');
  await store.addToWatchlist('JFC');
  await store.setMonthlyIncomeGoal(15000);
  const snapshot = await store.getSyncSnapshot();
  const buckets = await store.listBuckets();
  console.log(`buckets: ${snapshot.buckets.length} (expected ${buckets.length})`);
  console.log(`transactions: ${snapshot.transactions.length}`);
  console.log(`watchlist: ${snapshot.watchlist.length}`);
  console.log('settings:', snapshot.settings);

  const everyBucketHasUuid = snapshot.buckets.every((b) => !!b.uuid && !!b.updatedAt);
  const everyTxnHasUuidAndBucketUuid = snapshot.transactions.every(
    (t) => !!t.uuid && !!t.updatedAt && !!t.bucketUuid
  );
  const bucketUuids = new Set(snapshot.buckets.map((b) => b.uuid));
  const everyTxnBucketUuidResolves = snapshot.transactions.every((t) => bucketUuids.has(t.bucketUuid));
  console.log('every bucket has uuid+updatedAt:', everyBucketHasUuid);
  console.log('every txn has uuid+updatedAt+bucketUuid:', everyTxnHasUuidAndBucketUuid);
  console.log('every txn.bucketUuid resolves to a real bucket:', everyTxnBucketUuidResolves);
  if (!everyBucketHasUuid || !everyTxnHasUuidAndBucketUuid || !everyTxnBucketUuidResolves) {
    throw new Error('sync snapshot integrity check failed - see above');
  }

  console.log('\n=== Scenario 6: lastSyncedAt round-trip ===');
  console.log('before:', await store.getLastSyncedAt());
  const stamp = new Date().toISOString();
  await store.setLastSyncedAt(stamp);
  const after = await store.getLastSyncedAt();
  console.log('after:', after);
  if (after !== stamp) throw new Error(`lastSyncedAt round-trip mismatch: wrote ${stamp}, read ${after}`);

  console.log('\n=== Scenario 7: restore round-trip (Phase 3) ===');
  // Exercises the REAL restoreFromSyncSnapshot against the real IndexedDB
  // code path - restoring this store's own current snapshot back onto
  // itself should be a no-op from the outside: same counts, same computed
  // holdings, same settings. Also proves the wipe-then-reinsert doesn't
  // touch lastSyncedAt/hasCompletedInitialRestore, which live in the same
  // settings store but aren't part of a SyncSnapshot.
  const beforeRestore = await store.getSyncSnapshot();
  const beforeHoldings = await store.getAllHoldings();
  const lastSyncedBeforeRestore = await store.getLastSyncedAt();
  console.log('hasAnyLocalData before:', await store.hasAnyLocalData());
  console.log('hasCompletedInitialRestore before:', await store.getHasCompletedInitialRestore());

  const restoreResult = await store.restoreFromSyncSnapshot(beforeRestore);
  console.log('restore result:', restoreResult);
  await store.setHasCompletedInitialRestore(true);

  const afterRestore = await store.getSyncSnapshot();
  const afterHoldings = await store.getAllHoldings();
  console.log(`buckets: ${afterRestore.buckets.length} (expected ${beforeRestore.buckets.length})`);
  console.log(`transactions: ${afterRestore.transactions.length} (expected ${beforeRestore.transactions.length})`);
  console.log(`watchlist: ${afterRestore.watchlist.length} (expected ${beforeRestore.watchlist.length})`);
  console.log('settings after:', afterRestore.settings);
  console.log('hasAnyLocalData after:', await store.hasAnyLocalData());
  console.log('hasCompletedInitialRestore after:', await store.getHasCompletedInitialRestore());
  console.log('lastSyncedAt untouched by restore:', (await store.getLastSyncedAt()) === lastSyncedBeforeRestore);

  if (restoreResult.bucketsWritten !== beforeRestore.buckets.length) throw new Error('restore bucket count mismatch');
  if (restoreResult.transactionsWritten !== beforeRestore.transactions.length) throw new Error('restore transaction count mismatch');
  if (restoreResult.watchlistWritten !== beforeRestore.watchlist.length) throw new Error('restore watchlist count mismatch');
  if (JSON.stringify(afterHoldings) !== JSON.stringify(beforeHoldings)) throw new Error('holdings changed after restore round-trip - bucket_id linkage likely broken');
  if (afterRestore.settings.monthlyIncomeGoal !== beforeRestore.settings.monthlyIncomeGoal) throw new Error('monthlyIncomeGoal mismatch after restore');
  if ((await store.getLastSyncedAt()) !== lastSyncedBeforeRestore) throw new Error('restore incorrectly touched lastSyncedAt');
  if (!(await store.getHasCompletedInitialRestore())) throw new Error('hasCompletedInitialRestore did not stick');

  console.log('\n=== Scenario 8: restore skips tombstoned/orphaned rows defensively ===');
  // A hand-built snapshot standing in for "what a buggy or partial cloud
  // pull could contain" - a soft-deleted bucket (deletedAt set - not
  // producible by this app yet per Phase 0, but the field exists) and a
  // transaction referencing a bucketUuid that isn't in the snapshot at all.
  // Both should be silently skipped, not crash the restore.
  const now = new Date().toISOString();
  const synthetic: SyncSnapshot = {
    buckets: [
      { uuid: 'b-live', name: 'Synthetic Live', yieldLow: null, yieldHigh: null, sortOrder: 0, updatedAt: now, deletedAt: null },
      { uuid: 'b-deleted', name: 'Synthetic Deleted', yieldLow: null, yieldHigh: null, sortOrder: 0, updatedAt: now, deletedAt: now },
    ],
    transactions: [
      { uuid: 't-live', bucketUuid: 'b-live', date: '2026-01-01', type: 'BUY', stock: 'TEST', description: null, quantity: 10, price: 1, fees: null, currency: 'PHP', amount: -10, rowHash: 'synthetic1', isManual: true, updatedAt: now, deletedAt: null },
      { uuid: 't-orphan', bucketUuid: 'b-does-not-exist', date: '2026-01-02', type: 'BUY', stock: 'TEST2', description: null, quantity: 5, price: 1, fees: null, currency: 'PHP', amount: -5, rowHash: 'synthetic2', isManual: true, updatedAt: now, deletedAt: null },
    ],
    watchlist: [],
    settings: { monthlyIncomeGoal: null, themeMode: 'system', updatedAt: now },
  };
  const syntheticResult = await store.restoreFromSyncSnapshot(synthetic);
  console.log('synthetic restore result:', syntheticResult);
  if (syntheticResult.bucketsWritten !== 1) throw new Error(`expected 1 bucket written (tombstone skipped), got ${syntheticResult.bucketsWritten}`);
  if (syntheticResult.transactionsWritten !== 1) throw new Error(`expected 1 transaction written (orphan skipped), got ${syntheticResult.transactionsWritten}`);
  const postSynthetic = await store.listBuckets();
  console.log('buckets after synthetic restore:', postSynthetic.map((b) => b.name));
  if (postSynthetic.length !== 1 || postSynthetic[0].name !== 'Synthetic Live') {
    throw new Error('unexpected bucket state after synthetic restore');
  }

  console.log('\n=== Scenario 9: bucket soft-delete + revival (Phase 4a) ===');
  // Picks up the single live bucket ("Synthetic Live", from Scenario 8) plus
  // its one live manual transaction ("t-live"). Exercises the actual
  // soft-delete path end-to-end against real IndexedDB: the "can't delete a
  // bucket with holdings" guard must still block while the transaction is
  // live, then un-block once that transaction is itself tombstoned (not
  // just gone) - and getOrCreateBucket must revive the same row (not insert
  // a second one) when the name is reused after deletion, since `by_name`
  // is a unique index.
  const liveBucketBefore = (await store.listBuckets())[0];
  console.log('bucket before:', liveBucketBefore);
  const manualTxnsBefore = await store.getManualTransactions('Synthetic Live');
  if (manualTxnsBefore.length !== 1) throw new Error(`expected 1 manual transaction, got ${manualTxnsBefore.length}`);
  const liveTxnId = manualTxnsBefore[0].id;

  let guardHeld = false;
  try {
    await store.deleteBucket(liveBucketBefore.id);
  } catch (e: any) {
    guardHeld = /existing holdings/.test(String(e?.message ?? e));
  }
  console.log('delete blocked while transaction is live:', guardHeld);
  if (!guardHeld) throw new Error('deleteBucket should have refused - bucket still has a live transaction');

  await store.deleteManualTransaction(liveTxnId);
  console.log('hasAnyLocalData after tombstoning the only transaction (bucket still live):', await store.hasAnyLocalData());
  await store.deleteBucket(liveBucketBefore.id); // should now succeed - only tombstoned txns remain
  console.log('buckets after delete:', (await store.listBuckets()).map((b) => b.name));
  console.log('hasAnyLocalData after bucket + transaction both tombstoned:', await store.hasAnyLocalData());
  if ((await store.listBuckets()).length !== 0) throw new Error('bucket should no longer be listed after soft-delete');
  if (await store.hasAnyLocalData()) throw new Error('hasAnyLocalData should be false - only tombstones remain');

  const revivedId = await store.getOrCreateBucket('Synthetic Live');
  console.log('revived bucket id === original id:', revivedId === liveBucketBefore.id);
  if (revivedId !== liveBucketBefore.id) throw new Error('getOrCreateBucket should have revived the tombstoned row, not inserted a new one');
  const bucketsAfterRevival = await store.listBuckets();
  console.log('buckets after revival:', bucketsAfterRevival.map((b) => b.name));
  if (bucketsAfterRevival.length !== 1 || bucketsAfterRevival[0].name !== 'Synthetic Live') {
    throw new Error('bucket did not come back correctly after revival');
  }
  if (!(await store.hasAnyLocalData())) throw new Error('hasAnyLocalData should be true again after revival');

  console.log('\n=== Scenario 10: watchlist soft-delete + revival, both entry points (Phase 4a) ===');
  // addToWatchlist and importPortfolioIntoWatchlist each have their own
  // revival branch (ticker is the IndexedDB keyPath, so a tombstoned row
  // permanently occupies it otherwise) - exercise both rather than trusting
  // they behave the same because the code looks similar.
  await store.addToWatchlist('TEST9');
  if (!(await store.getWatchlist()).some((w) => w.ticker === 'TEST9')) throw new Error('TEST9 should be on the watchlist after add');
  await store.removeFromWatchlist('TEST9');
  const afterRemove = await store.getWatchlist();
  console.log('TEST9 present after soft-delete:', afterRemove.some((w) => w.ticker === 'TEST9'));
  if (afterRemove.some((w) => w.ticker === 'TEST9')) throw new Error('TEST9 should be hidden after removeFromWatchlist');

  await store.addToWatchlist('TEST9'); // revival path #1: addToWatchlist
  const afterRevive1 = await store.getWatchlist();
  const revived1 = afterRevive1.find((w) => w.ticker === 'TEST9');
  console.log('TEST9 present after addToWatchlist revival:', !!revived1, revived1);
  if (!revived1) throw new Error('addToWatchlist should have revived TEST9');
  if (revived1.buyBelowPrice !== null) throw new Error('revival via addToWatchlist should reset buyBelowPrice to null');

  await store.removeFromWatchlist('TEST9'); // tombstone again, for revival path #2
  const importResult = await store.importPortfolioIntoWatchlist([{ ticker: 'TEST9', buyBelowPrice: 12.5 }]); // revival path #2: importPortfolioIntoWatchlist
  console.log('import result (should count the revival as "added", not a price merge):', importResult);
  if (importResult.added !== 1) throw new Error(`expected importPortfolioIntoWatchlist to count the revival as added, got ${JSON.stringify(importResult)}`);
  const afterRevive2 = await store.getWatchlist();
  const revived2 = afterRevive2.find((w) => w.ticker === 'TEST9');
  console.log('TEST9 present after importPortfolioIntoWatchlist revival:', !!revived2, revived2);
  if (!revived2 || revived2.buyBelowPrice !== 12.5) throw new Error('importPortfolioIntoWatchlist revival should set buyBelowPrice from the incoming row');

  console.log('\n=== Scenario 11: applySynced* per-record upsert (Phase 4b) ===');
  // Distinct from Scenario 7/8's restoreFromSyncSnapshot (wipe + reinsert
  // everything) - these methods insert-or-update ONE record by its stable
  // key (uuid for buckets/transactions, ticker for watchlist), which is
  // what a repeatable bidirectional sync needs so it doesn't clobber
  // unrelated local rows on every run.
  const now11 = new Date().toISOString();
  const later11 = new Date(Date.now() + 1000).toISOString();

  // 11a: applySyncedBucket insert - a uuid brand new to this device.
  await store.applySyncedBucket({
    uuid: 'synced-bucket-1', name: 'Synced Bucket', yieldLow: 4, yieldHigh: 5,
    sortOrder: 0, updatedAt: now11, deletedAt: null,
  });
  let bucketsAfter11a = await store.listBuckets();
  const insertedBucket = bucketsAfter11a.find((b) => b.name === 'Synced Bucket');
  console.log('11a: bucket inserted via applySyncedBucket:', !!insertedBucket);
  if (!insertedBucket) throw new Error('11a failed: applySyncedBucket should have inserted a new bucket');

  // 11b: applySyncedBucket update - same uuid, new name -> same local id, no duplicate row.
  await store.applySyncedBucket({
    uuid: 'synced-bucket-1', name: 'Synced Bucket Renamed', yieldLow: 4, yieldHigh: 5,
    sortOrder: 0, updatedAt: later11, deletedAt: null,
  });
  const bucketsAfter11b = await store.listBuckets();
  const renamedBucket = bucketsAfter11b.find((b) => b.id === insertedBucket.id);
  console.log('11b: bucket updated in place (same id, new name):', renamedBucket?.name);
  if (renamedBucket?.name !== 'Synced Bucket Renamed') throw new Error('11b failed: applySyncedBucket should update the existing row by uuid, not insert a second one');
  if (bucketsAfter11b.filter((b) => b.name.startsWith('Synced Bucket')).length !== 1) throw new Error('11b failed: applySyncedBucket produced a duplicate row instead of updating in place');

  // 11c: applySyncedTransaction insert - valid bucketUuid resolves to the bucket just created.
  await store.applySyncedTransaction({
    uuid: 'synced-txn-1', bucketUuid: 'synced-bucket-1', date: '2026-01-05', type: 'BUY',
    stock: 'SYNC', description: null, quantity: 10, price: 5, fees: null, currency: 'PHP',
    amount: -50, rowHash: 'synced-hash-1', isManual: true, updatedAt: now11, deletedAt: null,
  });
  const manualAfter11c = await store.getManualTransactions('Synced Bucket Renamed');
  console.log('11c: transaction inserted via applySyncedTransaction:', manualAfter11c.map((t) => t.stock));
  if (!manualAfter11c.some((t) => t.stock === 'SYNC' && t.quantity === 10)) throw new Error('11c failed: applySyncedTransaction should have inserted the transaction under the resolved bucket');

  // 11d: applySyncedTransaction update - same uuid, different quantity -> updates in place.
  await store.applySyncedTransaction({
    uuid: 'synced-txn-1', bucketUuid: 'synced-bucket-1', date: '2026-01-05', type: 'BUY',
    stock: 'SYNC', description: null, quantity: 25, price: 5, fees: null, currency: 'PHP',
    amount: -125, rowHash: 'synced-hash-1', isManual: true, updatedAt: later11, deletedAt: null,
  });
  const manualAfter11d = await store.getManualTransactions('Synced Bucket Renamed');
  const syncTxns = manualAfter11d.filter((t) => t.stock === 'SYNC');
  console.log('11d: transaction updated in place (qty 10 -> 25), row count:', syncTxns.length);
  if (syncTxns.length !== 1 || syncTxns[0].quantity !== 25) throw new Error('11d failed: applySyncedTransaction should update the existing row by uuid, not duplicate it');

  // 11e: applySyncedTransaction orphan skip - bucketUuid resolves to nothing locally.
  await store.applySyncedTransaction({
    uuid: 'synced-txn-orphan', bucketUuid: 'no-such-bucket-uuid', date: '2026-01-06', type: 'BUY',
    stock: 'ORPHAN', description: null, quantity: 1, price: 1, fees: null, currency: 'PHP',
    amount: -1, rowHash: 'synced-hash-orphan', isManual: true, updatedAt: now11, deletedAt: null,
  });
  const allHoldingsAfter11e = await store.getAllHoldings();
  console.log('11e: orphaned transaction silently skipped (no ORPHAN ticker present):', !allHoldingsAfter11e.some((h) => h.ticker === 'ORPHAN'));
  if (allHoldingsAfter11e.some((h) => h.ticker === 'ORPHAN')) throw new Error('11e failed: applySyncedTransaction should skip a record whose bucketUuid does not resolve locally');

  // 11f: applySyncedWatchlistItem insert + update - ticker IS the key, so no scan needed either way.
  await store.applySyncedWatchlistItem({ ticker: 'SYNCTIX', buyBelowPrice: 8, addedAt: now11, updatedAt: now11, deletedAt: null });
  const watchlistAfter11f = await store.getWatchlist();
  console.log('11f: watchlist item inserted via applySyncedWatchlistItem:', watchlistAfter11f.find((w) => w.ticker === 'SYNCTIX'));
  if (!watchlistAfter11f.some((w) => w.ticker === 'SYNCTIX' && w.buyBelowPrice === 8)) throw new Error('11f failed: applySyncedWatchlistItem should have inserted SYNCTIX');

  await store.applySyncedWatchlistItem({ ticker: 'SYNCTIX', buyBelowPrice: 6.5, addedAt: now11, updatedAt: later11, deletedAt: null });
  const watchlistAfter11g = await store.getWatchlist();
  const syncTix = watchlistAfter11g.filter((w) => w.ticker === 'SYNCTIX');
  console.log('11g: watchlist item updated in place (price 8 -> 6.5), row count:', syncTix.length);
  if (syncTix.length !== 1 || syncTix[0].buyBelowPrice !== 6.5) throw new Error('11g failed: applySyncedWatchlistItem should update in place, not duplicate');

  // 11h: applySyncedSettings overwrites both fields from the winning record.
  await store.applySyncedSettings({ monthlyIncomeGoal: 42000, themeMode: 'dark', updatedAt: later11 });
  const goalAfter11h = await store.getMonthlyIncomeGoal();
  const themeAfter11h = await store.getThemeMode();
  console.log('11h: applySyncedSettings applied ->', { goalAfter11h, themeAfter11h });
  if (goalAfter11h !== 42000 || themeAfter11h !== 'dark') throw new Error('11h failed: applySyncedSettings should overwrite monthlyIncomeGoal and themeMode');
}

main().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
