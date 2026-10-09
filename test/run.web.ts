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
  if (!fs.existsSync(filePath)) {
    console.warn(`[test/run.web] Warning: Sample file not found at ${filePath}. Using empty rows for test.`);
    return [];
  }
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
      { uuid: 'b-live', name: 'Synthetic Live', yieldLow: null, yieldHigh: null, color: null, sortOrder: 0, updatedAt: now, deletedAt: null },
      { uuid: 'b-deleted', name: 'Synthetic Deleted', yieldLow: null, yieldHigh: null, color: null, sortOrder: 0, updatedAt: now, deletedAt: now },
    ],
    transactions: [
      { uuid: 't-live', bucketUuid: 'b-live', date: '2026-01-01', type: 'BUY', stock: 'TEST', description: null, quantity: 10, price: 1, fees: null, currency: 'PHP', amount: -10, rowHash: 'synthetic1', isManual: true, updatedAt: now, deletedAt: null },
      { uuid: 't-orphan', bucketUuid: 'b-does-not-exist', date: '2026-01-02', type: 'BUY', stock: 'TEST2', description: null, quantity: 5, price: 1, fees: null, currency: 'PHP', amount: -5, rowHash: 'synthetic2', isManual: true, updatedAt: now, deletedAt: null },
    ],
    watchlist: [],
    stockNotes: [],
    stockTags: [],
    stockAlerts: [],
    stockTrackerEntries: [],
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
    uuid: 'synced-bucket-1', name: 'Synced Bucket', yieldLow: 4, yieldHigh: 5, color: null,
    sortOrder: 0, updatedAt: now11, deletedAt: null,
  });
  let bucketsAfter11a = await store.listBuckets();
  const insertedBucket = bucketsAfter11a.find((b) => b.name === 'Synced Bucket');
  console.log('11a: bucket inserted via applySyncedBucket:', !!insertedBucket);
  if (!insertedBucket) throw new Error('11a failed: applySyncedBucket should have inserted a new bucket');

  // 11b: applySyncedBucket update - same uuid, new name -> same local id, no duplicate row.
  await store.applySyncedBucket({
    uuid: 'synced-bucket-1', name: 'Synced Bucket Renamed', yieldLow: 4, yieldHigh: 5, color: null,
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

  console.log('\n=== Scenario 12: stock notes CRUD, soft-delete, and sync upsert ===');
  // Mirrors the watchlist coverage above (Scenario 10/11f-g), just keyed by
  // id instead of ticker, and a ticker can have many notes instead of one row.
  const addedNote = await store.addStockNote('SYNCNOTE', '<p>Bought the dip <b>again</b></p>');
  console.log('12a: note added:', addedNote);
  if (addedNote.ticker !== 'SYNCNOTE' || !addedNote.id) throw new Error('12a failed: addStockNote should return the created note with an id');

  const notesAfterAdd = await store.getStockNotes('SYNCNOTE');
  console.log('12b: feed after add:', notesAfterAdd);
  if (notesAfterAdd.length !== 1 || notesAfterAdd[0].id !== addedNote.id) throw new Error('12b failed: getStockNotes should return the just-added note');

  await store.updateStockNote(addedNote.id, '<p>Bought the dip <b>again</b>, edited</p>');
  const notesAfterUpdate = await store.getStockNotes('SYNCNOTE');
  console.log('12c: feed after edit:', notesAfterUpdate);
  if (notesAfterUpdate.length !== 1 || !notesAfterUpdate[0].contentHtml.includes('edited')) throw new Error('12c failed: updateStockNote should edit content in place, not add a row');
  if (notesAfterUpdate[0].createdAt !== addedNote.createdAt) throw new Error('12c failed: updateStockNote should leave createdAt untouched');

  await store.deleteStockNote(addedNote.id);
  const notesAfterDelete = await store.getStockNotes('SYNCNOTE');
  console.log('12d: feed after soft-delete:', notesAfterDelete);
  if (notesAfterDelete.length !== 0) throw new Error('12d failed: deleteStockNote should hide the note from getStockNotes');

  // 12e: applySyncedStockNote insert - a uuid brand new to this device.
  await store.applySyncedStockNote({
    uuid: 'synced-note-1', ticker: 'SYNCNOTE2', contentHtml: '<p>From another device</p>',
    createdAt: now11, updatedAt: now11, deletedAt: null,
  });
  const notesAfter12e = await store.getStockNotes('SYNCNOTE2');
  console.log('12e: note inserted via applySyncedStockNote:', notesAfter12e);
  if (notesAfter12e.length !== 1 || notesAfter12e[0].id !== 'synced-note-1') throw new Error('12e failed: applySyncedStockNote should have inserted a new note');

  // 12f: applySyncedStockNote update - same uuid, new content -> updates in place, no duplicate.
  await store.applySyncedStockNote({
    uuid: 'synced-note-1', ticker: 'SYNCNOTE2', contentHtml: '<p>Edited from another device</p>',
    createdAt: now11, updatedAt: later11, deletedAt: null,
  });
  const notesAfter12f = await store.getStockNotes('SYNCNOTE2');
  console.log('12f: note updated in place, row count:', notesAfter12f.length, notesAfter12f[0]?.contentHtml);
  if (notesAfter12f.length !== 1 || !notesAfter12f[0].contentHtml.includes('Edited')) throw new Error('12f failed: applySyncedStockNote should update the existing row by uuid, not duplicate it');

  // 12g: restoreFromSyncSnapshot round-trips stockNotes too (Scenario 7 only checked buckets/transactions/watchlist counts).
  const snapshotWithNotes = await store.getSyncSnapshot();
  console.log('12g: snapshot includes notes:', snapshotWithNotes.stockNotes.length);
  if (!snapshotWithNotes.stockNotes.some((n) => n.uuid === 'synced-note-1')) throw new Error('12g failed: getSyncSnapshot should include stock notes');
  const restoreWithNotes = await store.restoreFromSyncSnapshot(snapshotWithNotes);
  console.log('12g: restore result includes stockNotesWritten:', restoreWithNotes.stockNotesWritten);
  const liveNotesBefore = snapshotWithNotes.stockNotes.filter((n) => !n.deletedAt).length;
  if (restoreWithNotes.stockNotesWritten !== liveNotesBefore) throw new Error('12g failed: restoreFromSyncSnapshot should reinsert every live note');

  console.log('\n=== Scenario 13: stock tags CRUD, soft-delete, and sync upsert ===');
  // 13a: setTagsForTicker (insert 3 tags on two tickers).
  await store.setTagsForTicker('TAGA', ['#growth', '#ph-blue-chip', '#recession-proof']);
  await store.setTagsForTicker('TAGB', ['#growth', '#feeder-US']);
  const tagsForA = await store.getTagsForTicker('TAGA');
  console.log('13a: tags for TAGA after insert:', tagsForA.map((t) => t.tag));
  if (tagsForA.length !== 3) throw new Error('13a failed: expected 3 tags on TAGA');
  if (!tagsForA.every((t) => t.deletedAt === null)) throw new Error('13a failed: all tags should be live (deletedAt null)');

  // 13b: getAllTagsWithCounts - #growth is on 2 tickers, others on 1 each.
  const allTagCounts = await store.getAllTagsWithCounts();
  console.log('13b: all tags with counts:', allTagCounts);
  const growthRow = allTagCounts.find((r) => r.tag === '#growth');
  if (!growthRow) throw new Error('13b failed: #growth should appear in getAllTagsWithCounts');
  if (growthRow.tickerCount !== 2) throw new Error(`13b failed: #growth should have tickerCount 2, got ${growthRow.tickerCount}`);
  if (allTagCounts.length !== 4) throw new Error(`13b failed: expected 4 distinct tags total, got ${allTagCounts.length}`);

  // 13c: setTagsForTicker to remove one tag (soft-delete #recession-proof from TAGA).
  await store.setTagsForTicker('TAGA', ['#growth', '#ph-blue-chip']); // drop #recession-proof
  const tagsForAAfterRemove = await store.getTagsForTicker('TAGA');
  console.log('13c: tags for TAGA after removing #recession-proof:', tagsForAAfterRemove.map((t) => t.tag));
  if (tagsForAAfterRemove.length !== 2) throw new Error(`13c failed: expected 2 live tags on TAGA, got ${tagsForAAfterRemove.length}`);
  if (tagsForAAfterRemove.some((t) => t.tag === '#recession-proof')) throw new Error('13c failed: #recession-proof should be soft-deleted');

  // 13d: getAllTagsWithCounts now shows #recession-proof gone (all its assignments tombstoned).
  const allTagCountsAfter = await store.getAllTagsWithCounts();
  console.log('13d: counts after removal:', allTagCountsAfter);
  if (allTagCountsAfter.some((r) => r.tag === '#recession-proof')) throw new Error('13d failed: #recession-proof should not appear once all its assignments are tombstoned');
  if (allTagCountsAfter.length !== 3) throw new Error(`13d failed: expected 3 distinct tags after remove, got ${allTagCountsAfter.length}`);

  // 13e: getTickersForTag reverse lookup.
  const tickersForGrowth = await store.getTickersForTag('#growth');
  console.log('13e: tickers for #growth:', tickersForGrowth.map((r) => r.ticker));
  if (tickersForGrowth.length !== 2) throw new Error(`13e failed: expected 2 tickers for #growth, got ${tickersForGrowth.length}`);

  // 13f: applySyncedTag insert - a pair brand new to this store.
  const syncTagNow = new Date().toISOString();
  await store.applySyncedTag({ ticker: 'TAGC', tag: '#synced-tag', assignedAt: syncTagNow, updatedAt: syncTagNow, deletedAt: null });
  const tagsForC = await store.getTagsForTicker('TAGC');
  console.log('13f: applySyncedTag insert:', tagsForC);
  if (tagsForC.length !== 1 || tagsForC[0].tag !== '#synced-tag') throw new Error('13f failed: applySyncedTag should have inserted #synced-tag on TAGC');

  // 13g: applySyncedTag tombstone - same pair, deletedAt set.
  const laterTag = new Date(Date.now() + 5000).toISOString();
  await store.applySyncedTag({ ticker: 'TAGC', tag: '#synced-tag', assignedAt: syncTagNow, updatedAt: laterTag, deletedAt: laterTag });
  const tagsForCAfterTombstone = await store.getTagsForTicker('TAGC');
  console.log('13g: tags for TAGC after tombstone:', tagsForCAfterTombstone.length);
  if (tagsForCAfterTombstone.length !== 0) throw new Error('13g failed: tombstoned tag should be hidden from getTagsForTicker');

  // 13h: getSyncSnapshot includes all stock_tags (including tombstones).
  const snapshotWithTags = await store.getSyncSnapshot();
  console.log('13h: snapshot stockTags count:', snapshotWithTags.stockTags.length);
  if (!snapshotWithTags.stockTags.some((t) => t.ticker === 'TAGA' && t.tag === '#growth')) throw new Error('13h failed: snapshot should include TAGA/#growth');
  // restoreFromSyncSnapshot round-trip: live tags come back, tombstones are skipped.
  const liveBefore = snapshotWithTags.stockTags.filter((t) => !t.deletedAt).length;
  const restoreWithTags = await store.restoreFromSyncSnapshot(snapshotWithTags);
  console.log('13h: restore result stockTagsWritten:', restoreWithTags.stockTagsWritten, '(live before restore:', liveBefore, ')');
  if (restoreWithTags.stockTagsWritten !== liveBefore) throw new Error('13h failed: restoreFromSyncSnapshot should reinsert every live tag');
  console.log('\n=== Scenario 14: stock alerts CRUD, soft-delete, and sync upsert ===');
  // 14a: addStockAlert - event type.
  const alertNow = new Date().toISOString();
  const eventAlert = await store.addStockAlert({
    ticker: 'ALRT', type: 'event', title: 'AGM 2026',
    eventDate: '2026-11-15', eventTime: '09:00', reminderTiming: 'day-before',
    priceDirection: null, priceThreshold: null,
    email: 'test@example.com', status: 'active',
    lastTriggeredAt: null, lastTriggeredValue: null, lastCheckedAt: null,
  });
  console.log('14a: event alert created:', eventAlert.id, eventAlert.title);
  if (!eventAlert.id || eventAlert.ticker !== 'ALRT' || eventAlert.type !== 'event') throw new Error('14a failed: event alert not created correctly');

  // 14b: addStockAlert - price type.
  const priceAlert = await store.addStockAlert({
    ticker: 'ALRT', type: 'price', title: 'ALRT drops below 1.50',
    eventDate: null, eventTime: null, reminderTiming: null,
    priceDirection: 'below', priceThreshold: 1.50,
    email: 'test@example.com', status: 'active',
    lastTriggeredAt: null, lastTriggeredValue: null, lastCheckedAt: null,
  });
  console.log('14b: price alert created:', priceAlert.id, priceAlert.priceThreshold);
  if (priceAlert.priceDirection !== 'below' || priceAlert.priceThreshold !== 1.50) throw new Error('14b failed: price alert not created correctly');

  // 14c: getAlertsForTicker returns both live alerts.
  const alertsForAlrt = await store.getAlertsForTicker('ALRT');
  console.log('14c: getAlertsForTicker count:', alertsForAlrt.length);
  if (alertsForAlrt.length !== 2) throw new Error(`14c failed: expected 2 alerts for ALRT, got ${alertsForAlrt.length}`);

  // 14d: updateStockAlert - pause the event alert.
  await store.updateStockAlert(eventAlert.id, { status: 'paused', title: 'AGM 2026 (updated)' });
  const alertsAfterUpdate = await store.getAlertsForTicker('ALRT');
  const updated = alertsAfterUpdate.find((a) => a.id === eventAlert.id);
  console.log('14d: after update, status:', updated?.status, 'title:', updated?.title);
  if (updated?.status !== 'paused' || updated?.title !== 'AGM 2026 (updated)') throw new Error('14d failed: updateStockAlert did not apply correctly');

  // 14e: deleteStockAlert - soft-delete the price alert.
  await store.deleteStockAlert(priceAlert.id);
  const alertsAfterDelete = await store.getAlertsForTicker('ALRT');
  console.log('14e: after soft-delete, live alert count:', alertsAfterDelete.length);
  if (alertsAfterDelete.length !== 1) throw new Error(`14e failed: expected 1 live alert after soft-delete, got ${alertsAfterDelete.length}`);
  if (alertsAfterDelete[0].id !== eventAlert.id) throw new Error('14e failed: the surviving alert should be the event alert');

  // 14f: listAllStockAlerts excludes tombstoned.
  const allAlerts = await store.listAllStockAlerts();
  console.log('14f: listAllStockAlerts count:', allAlerts.length);
  if (!allAlerts.some((a) => a.id === eventAlert.id)) throw new Error('14f failed: event alert should appear in listAllStockAlerts');
  if (allAlerts.some((a) => a.id === priceAlert.id)) throw new Error('14f failed: soft-deleted price alert must not appear in listAllStockAlerts');

  // 14g: applySyncedStockAlert insert - a uuid new to this store.
  const syncAlertId = 'synced-alert-1';
  const syncAlertNow = new Date().toISOString();
  await store.applySyncedStockAlert({
    id: syncAlertId, ticker: 'ALRT2', type: 'price', title: 'ALRT2 above 5',
    eventDate: null, eventTime: null, reminderTiming: null,
    priceDirection: 'above', priceThreshold: 5,
    email: 'other@example.com', status: 'active',
    createdAt: syncAlertNow, updatedAt: syncAlertNow, deletedAt: null,
    lastTriggeredAt: null, lastTriggeredValue: null, lastCheckedAt: null,
  });
  const alertsForAlrt2 = await store.getAlertsForTicker('ALRT2');
  console.log('14g: applySyncedStockAlert insert count:', alertsForAlrt2.length);
  if (alertsForAlrt2.length !== 1 || alertsForAlrt2[0].id !== syncAlertId) throw new Error('14g failed: applySyncedStockAlert should insert new alert');

  // 14h: applySyncedStockAlert update - same id, new title -> updates in place.
  const laterSyncAlert = new Date(Date.now() + 5000).toISOString();
  await store.applySyncedStockAlert({
    id: syncAlertId, ticker: 'ALRT2', type: 'price', title: 'ALRT2 above 5 (synced update)',
    eventDate: null, eventTime: null, reminderTiming: null,
    priceDirection: 'above', priceThreshold: 5,
    email: 'other@example.com', status: 'paused',
    createdAt: syncAlertNow, updatedAt: laterSyncAlert, deletedAt: null,
    lastTriggeredAt: null, lastTriggeredValue: null, lastCheckedAt: null,
  });
  const alertsAfterSyncUpdate = await store.getAlertsForTicker('ALRT2');
  console.log('14h: after sync update, title:', alertsAfterSyncUpdate[0]?.title, 'status:', alertsAfterSyncUpdate[0]?.status);
  if (alertsAfterSyncUpdate.length !== 1 || alertsAfterSyncUpdate[0].status !== 'paused') throw new Error('14h failed: applySyncedStockAlert should update existing row, not duplicate');

  // 14i: getSyncSnapshot includes both live and tombstoned alerts.
  const snapshotWithAlerts = await store.getSyncSnapshot();
  console.log('14i: snapshot stockAlerts count:', snapshotWithAlerts.stockAlerts.length);
  if (!snapshotWithAlerts.stockAlerts.some((a) => a.id === eventAlert.id)) throw new Error('14i failed: snapshot should include eventAlert');
  if (!snapshotWithAlerts.stockAlerts.some((a) => a.id === priceAlert.id)) throw new Error('14i failed: snapshot should include tombstoned priceAlert');

  // 14j: restoreFromSyncSnapshot round-trip: live alerts reinserted, tombstones skipped.
  const liveAlertsBefore = snapshotWithAlerts.stockAlerts.filter((a) => !a.deletedAt).length;
  const restoreWithAlerts = await store.restoreFromSyncSnapshot(snapshotWithAlerts);
  console.log('14j: stockAlertsWritten:', restoreWithAlerts.stockAlertsWritten, '(live before restore:', liveAlertsBefore, ')');
  if (restoreWithAlerts.stockAlertsWritten !== liveAlertsBefore) throw new Error('14j failed: restoreFromSyncSnapshot should reinsert every live alert');

  console.log('\n=== Scenario 15: stock tracker CRUD, soft-delete, and sync upsert ===');
  // 15a: upsertStockTrackerEntry - insert.
  const tracker1 = await store.upsertStockTrackerEntry({
    ticker: 'TRK1',
    areaPriceOfInterest: '100-105',
    weeklyMacdTrend: 'bullish-converging',
    weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'buying',
    eventCatalyst: 'Q3 Earnings Beat',
    projection: 'Target 120',
    notes: 'Watch support at 98',
    priceAlertId: null,
  });
  console.log('15a: tracker entry created:', tracker1.id, tracker1.ticker);
  if (!tracker1.id || tracker1.ticker !== 'TRK1' || tracker1.weeklyMacdTrend !== 'bullish-converging') throw new Error('15a failed: tracker entry not created correctly');

  // 15b: getStockTrackerForTicker & getStockTrackerEntry.
  const fetchedByTicker = await store.getStockTrackerForTicker('TRK1');
  const fetchedById = await store.getStockTrackerEntry(tracker1.id);
  console.log('15b: fetched by ticker:', fetchedByTicker?.ticker, 'fetched by id:', fetchedById?.id);
  if (fetchedByTicker?.id !== tracker1.id || fetchedById?.ticker !== 'TRK1') throw new Error('15b failed: getStockTrackerForTicker or getStockTrackerEntry returned incorrect data');

  // 15c: listAllStockTrackerEntries.
  const allTrackers1 = await store.listAllStockTrackerEntries();
  console.log('15c: listAllStockTrackerEntries count:', allTrackers1.length);
  if (!allTrackers1.some((t) => t.id === tracker1.id)) throw new Error('15c failed: tracker1 missing from listAllStockTrackerEntries');

  // 15d: upsertStockTrackerEntry - update.
  const updatedTracker1 = await store.upsertStockTrackerEntry({
    id: tracker1.id,
    ticker: 'TRK1',
    areaPriceOfInterest: '100-105',
    weeklyMacdTrend: 'bearish-diverging',
    weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'selling',
    eventCatalyst: 'Q3 Earnings Beat',
    projection: 'Target 120',
    notes: 'Support broken, re-evaluating',
    priceAlertId: null,
  });
  console.log('15d: updated tracker weeklyMacdTrend:', updatedTracker1.weeklyMacdTrend, 'notes:', updatedTracker1.notes);
  if (updatedTracker1.id !== tracker1.id || updatedTracker1.weeklyMacdTrend !== 'bearish-diverging') throw new Error('15d failed: tracker entry update failed');

  // 15e: deleteStockTrackerEntry - soft-delete.
  await store.deleteStockTrackerEntry(tracker1.id);
  const fetchedAfterDelete = await store.getStockTrackerForTicker('TRK1');
  const allTrackersAfterDelete = await store.listAllStockTrackerEntries();
  console.log('15e: fetched after delete:', fetchedAfterDelete, 'list count:', allTrackersAfterDelete.length);
  if (fetchedAfterDelete !== null) throw new Error('15e failed: soft-deleted tracker entry returned by getStockTrackerForTicker');
  if (allTrackersAfterDelete.some((t) => t.id === tracker1.id)) throw new Error('15e failed: soft-deleted tracker entry returned by listAllStockTrackerEntries');

  // 15f: applySyncedStockTrackerEntry - insert.
  const syncTrackerId = 'synced-tracker-1';
  const syncTrackerNow = new Date().toISOString();
  await store.applySyncedStockTrackerEntry({
    id: syncTrackerId,
    ticker: 'TRK2',
    areaPriceOfInterest: '50-55',
    weeklyMacdTrend: 'sideways',
    weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'neutral',
    eventCatalyst: '',
    projection: '',
    notes: 'Synced from cloud',
    priceAlertId: null,
    createdAt: syncTrackerNow,
    updatedAt: syncTrackerNow,
    deletedAt: null,
  });
  const fetchedTrk2 = await store.getStockTrackerForTicker('TRK2');
  console.log('15f: applySyncedStockTrackerEntry insert:', fetchedTrk2?.id, fetchedTrk2?.ticker);
  if (fetchedTrk2?.id !== syncTrackerId || fetchedTrk2?.weeklyMacdTrend !== 'sideways') throw new Error('15f failed: applySyncedStockTrackerEntry insert failed');

  // 15g: applySyncedStockTrackerEntry - update.
  const laterSyncTracker = new Date(Date.now() + 5000).toISOString();
  await store.applySyncedStockTrackerEntry({
    id: syncTrackerId,
    ticker: 'TRK2',
    areaPriceOfInterest: '50-55',
    weeklyMacdTrend: 'bullish-diverging',
    weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'strong-buying',
    eventCatalyst: '',
    projection: '',
    notes: 'Synced update from cloud',
    priceAlertId: null,
    createdAt: syncTrackerNow,
    updatedAt: laterSyncTracker,
    deletedAt: null,
  });
  const fetchedTrk2Updated = await store.getStockTrackerForTicker('TRK2');
  console.log('15g: applySyncedStockTrackerEntry update weeklyMacdTrend:', fetchedTrk2Updated?.weeklyMacdTrend);
  if (fetchedTrk2Updated?.weeklyMacdTrend !== 'bullish-diverging') throw new Error('15g failed: applySyncedStockTrackerEntry update failed');

  // 15h: getSyncSnapshot & restoreFromSyncSnapshot.
  const snapshotWithTrackers = await store.getSyncSnapshot();
  console.log('15h: snapshot stockTrackerEntries count:', snapshotWithTrackers.stockTrackerEntries.length);
  if (!snapshotWithTrackers.stockTrackerEntries.some((t) => t.id === tracker1.id)) throw new Error('15h failed: snapshot should include tombstoned tracker1');
  if (!snapshotWithTrackers.stockTrackerEntries.some((t) => t.id === syncTrackerId)) throw new Error('15h failed: snapshot should include live syncTracker');

  const liveTrackersBefore = snapshotWithTrackers.stockTrackerEntries.filter((t) => !t.deletedAt).length;
  const restoreWithTrackers = await store.restoreFromSyncSnapshot(snapshotWithTrackers);
  console.log('15h: stockTrackerEntriesWritten:', restoreWithTrackers.stockTrackerEntriesWritten, '(live before restore:', liveTrackersBefore, ')');
  if (restoreWithTrackers.stockTrackerEntriesWritten !== liveTrackersBefore) throw new Error('15h failed: restoreFromSyncSnapshot should reinsert every live tracker entry');

  console.log('\n=== Scenario 16: tracker eventDate + linked event alert ===');
  // 16a: eventDate / eventAlertId persist through upsert.
  const evAlert = await store.addStockAlert({
    ticker: 'EVT1', type: 'event', title: 'Q3 Earnings release', eventDate: '2026-11-12', eventTime: null,
    reminderTiming: 'day-before', priceDirection: null, priceThreshold: null, email: 'wilb@example.com',
    status: 'active', lastTriggeredAt: null, lastTriggeredValue: null, lastCheckedAt: null,
  });
  const evTracker = await store.upsertStockTrackerEntry({
    ticker: 'EVT1', areaPriceOfInterest: '', weeklyMacdTrend: 'none', weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'unknown', eventCatalyst: 'Q3 Earnings release', eventDate: '2026-11-12',
    eventAlertId: evAlert.id, projection: '', notes: null, priceAlertId: null,
  });
  const evFetched = await store.getStockTrackerEntry(evTracker.id);
  console.log('16a: eventDate =', evFetched?.eventDate, ', eventAlertId matches alert:', evFetched?.eventAlertId === evAlert.id);
  if (evFetched?.eventDate !== '2026-11-12' || evFetched?.eventAlertId !== evAlert.id) throw new Error('16a failed: eventDate/eventAlertId should persist');

  // 16b: entries saved without the new fields read back as null (back-compat with older rows/snapshots).
  const legacy = await store.upsertStockTrackerEntry({
    ticker: 'EVT2', areaPriceOfInterest: '', weeklyMacdTrend: 'none', weeklyMacdTrendCustom: null,
    foreignFlowSentiment: 'unknown', eventCatalyst: 'Old free-text catalyst', projection: '', notes: null, priceAlertId: null,
  });
  if (legacy.eventDate !== null || legacy.eventAlertId !== null) throw new Error('16b failed: missing eventDate/eventAlertId should default to null');

  // 16c: snapshot + restore round-trip keeps them.
  const evSnap = await store.getSyncSnapshot();
  const evInSnap = evSnap.stockTrackerEntries.find((t) => t.id === evTracker.id);
  if (evInSnap?.eventDate !== '2026-11-12' || evInSnap?.eventAlertId !== evAlert.id) throw new Error('16c failed: snapshot should carry eventDate/eventAlertId');
  await store.restoreFromSyncSnapshot(evSnap);
  const evRestored = await store.getStockTrackerEntry(evTracker.id);
  if (evRestored?.eventDate !== '2026-11-12' || evRestored?.eventAlertId !== evAlert.id) throw new Error('16c failed: restore should keep eventDate/eventAlertId');

  // 16d: applySynced (newer remote) carries them too.
  await store.applySyncedStockTrackerEntry({ ...evTracker, eventDate: '2026-12-01', updatedAt: new Date(Date.now() + 60000).toISOString() });
  const evSynced = await store.getStockTrackerEntry(evTracker.id);
  console.log('16d: after applySynced eventDate =', evSynced?.eventDate);
  if (evSynced?.eventDate !== '2026-12-01') throw new Error('16d failed: applySynced should update eventDate');
  console.log('Scenario 16: all checks passed');

  console.log('\n=== Scenario 17: Transaction History feed exposes id/description; fund buy units can be filled in ===');
  await store.importIntoBucket('FeedFund', [{
    Date: '01/10/2026', Type: 'BUY', Stock: '26UF50', Description: 'ATRAM Nasdaq Equity Income Feeder Fund',
    Quantity: null, Price: null, 'Comm & Other Fees': null, Currency: 'PHP', Amount: 10000,
  }]);
  const feedBefore = await store.getBucketTransactionFeed('FeedFund');
  const pendingRow = feedBefore.find((t) => t.ticker === '26UF50');
  console.log('17a: feed row id =', pendingRow?.id, ', description =', pendingRow?.description, ', quantity =', pendingRow?.quantity);
  if (!pendingRow || pendingRow.id == null || !/fund/i.test(pendingRow.description ?? '') || pendingRow.quantity !== null) {
    throw new Error('17a failed: feed rows must carry id + description so the UI can offer "Add units"');
  }
  await store.updateFundTransaction(pendingRow.id, 100, 100);
  const feedAfter = (await store.getBucketTransactionFeed('FeedFund')).find((t) => t.id === pendingRow.id);
  console.log('17b: after update quantity =', feedAfter?.quantity, ', price =', feedAfter?.price);
  if (feedAfter?.quantity !== 100 || feedAfter?.price !== 100) throw new Error('17b failed: updateFundTransaction should be reflected in the feed');
  const fundPositions = await store.getBucketPositions('FeedFund');
  if (fundPositions.find((p) => p.ticker === '26UF50')?.pendingSettlement) throw new Error('17c failed: a filled-in fund buy should no longer be pending');
  console.log('Scenario 17: all checks passed');
}

main().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });

