// test/run.ts
// Tests the REAL production parsing path (core/xlsxRows.ts), not a
// separate reimplementation. An earlier version of this file had its own
// date-parsing logic that happened to be correct while the actual
// production code (xlsxImport.ts, now xlsxRows.ts) had a real bug -
// the test passing gave false confidence. Importing the real function
// closes that gap permanently.

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { RawRow } from '../core/bucketLogic';
import { rowsFromWorkbook } from '../core/xlsxRows';
import { prepareRows, computeHoldings } from '../core/bucketLogic';
import { mergeSnapshots } from '../core/syncMerge';
import { SyncSnapshot } from '../core/storeApi';

// Portable path (path.join handles Windows \ vs Unix / automatically) -
// this used to be hardcoded to this project's sandbox path
// (/mnt/user-data/uploads/...), which obviously doesn't exist outside that
// sandbox. Fixed to resolve relative to the project root instead.
// Place your sample export at: <project root>/user-data/uploads/<filename>
const SAMPLE_FILE = path.join(
  __dirname, '..', 'user-data', 'uploads', 'Transactions-Jul_1__2026__8_33_15_PM.xlsx'
);

function loadRows(filePath: string): RawRow[] {
  const buffer = fs.readFileSync(filePath); // mirrors what browser File.arrayBuffer() / native base64-decode both ultimately feed XLSX.read
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return rowsFromWorkbook(workbook);
}

class FakeBucketStore {
  private seen = new Set<string>();
  private txns: ReturnType<typeof prepareRows> = [];

  importRows(raw: RawRow[]) {
    const prepared = prepareRows(raw);
    let inserted = 0, skipped = 0;
    for (const t of prepared) {
      if (this.seen.has(t.rowHash)) { skipped++; continue; }
      this.seen.add(t.rowHash);
      this.txns.push(t);
      inserted++;
    }
    return { inserted, skipped };
  }

  holdings() { return computeHoldings(this.txns); }
}

const filePath = SAMPLE_FILE;
const allRows = loadRows(filePath);
const store = new FakeBucketStore();

console.log('=== Scenario 1: first import ===');
console.log(store.importRows(allRows));

console.log('\n=== Scenario 2: accidental exact re-import ===');
console.log(store.importRows(allRows));

console.log('\n=== Scenario 3: fresh export, 8 overlapping + 2 new ===');
const overlap = allRows.slice(-8);
const fresh: RawRow[] = [
  ...overlap,
  { Date: '05/02/2026', Type: 'BUY', Stock: 'MER', Description: 'MANILA ELECTRIC COMPANY',
    Quantity: 50, Price: 420.0, 'Comm & Other Fees': 61.95, Currency: 'PHP', Amount: -21061.95 },
  { Date: '06/02/2026', Type: 'CASH DIVIDEND', Stock: 'MREIT', Description: 'MREIT INC.',
    Quantity: 200, Price: 0.35, 'Comm & Other Fees': null, Currency: 'PHP', Amount: 70.0 },
];
console.log(store.importRows(fresh));

console.log('\n=== Final holdings ===');
const { holdings, orphanSells } = store.holdings();
console.table(holdings);
console.log('Orphan sells (no matching buy in dataset):', orphanSells.map(o => o.Stock));

console.log('\n=== Scenario 4: mergeSnapshots (Phase 4, sync-plan.md §10b) ===');
// Pure function, no I/O - see mergeSnapshots' doc comment in syncEngine.ts.
// Hand-built snapshots exercise every branch of the union-of-keys LWW
// compare directly, rather than relying on Scenario 9/10 in
// test/run.web.ts (real IndexedDB) to indirectly cover this logic.
{
  const OLD = '2026-01-01T00:00:00.000Z';
  const NEW = '2026-01-02T00:00:00.000Z';

  const bucket = (uuid: string, updatedAt: string, overrides: Partial<SyncSnapshot['buckets'][number]> = {}) => ({
    uuid, name: uuid, yieldLow: null, yieldHigh: null, sortOrder: 0, updatedAt, deletedAt: null, ...overrides,
  });
  const emptySnapshot = (settingsUpdatedAt: string): SyncSnapshot => ({
    buckets: [], transactions: [], watchlist: [],
    settings: { monthlyIncomeGoal: null, themeMode: 'system', updatedAt: settingsUpdatedAt },
  });

  // 4a: remote === null (never backed up) - everything local pushes, nothing pulls.
  const localOnly: SyncSnapshot = { ...emptySnapshot(OLD), buckets: [bucket('b1', OLD)] };
  const planNeverBackedUp = mergeSnapshots(localOnly, null);
  console.log('4a (remote null): toPush.buckets =', planNeverBackedUp.toPush.buckets.length, ', toPull.buckets =', planNeverBackedUp.toPull.buckets.length);
  if (planNeverBackedUp.toPush.buckets.length !== 1 || planNeverBackedUp.toPull.buckets.length !== 0) {
    throw new Error('4a failed: remote=null should push everything local, pull nothing');
  }

  // 4b: local-only key (present locally, absent remotely) -> push.
  // 4c: remote-only key (absent locally, present remotely) -> pull.
  // 4d: present both sides, local newer -> push (whole record, not a field merge).
  // 4e: present both sides, remote newer -> pull.
  // 4f: present both sides, identical updatedAt -> no-op (neither list).
  const local: SyncSnapshot = {
    ...emptySnapshot(OLD),
    buckets: [
      bucket('local-only', NEW),
      bucket('local-newer', NEW, { name: 'Local Version' }),
      bucket('remote-newer', OLD, { name: 'Stale Local Version' }),
      bucket('unchanged', OLD),
    ],
  };
  const remote: SyncSnapshot = {
    ...emptySnapshot(OLD),
    buckets: [
      bucket('remote-only', NEW),
      bucket('local-newer', OLD, { name: 'Stale Remote Version' }),
      bucket('remote-newer', NEW, { name: 'Remote Version' }),
      bucket('unchanged', OLD),
    ],
  };
  const plan = mergeSnapshots(local, remote);
  const pushUuids = plan.toPush.buckets.map((b) => b.uuid).sort();
  const pullUuids = plan.toPull.buckets.map((b) => b.uuid).sort();
  console.log('4b-4f: toPush uuids =', pushUuids, ', toPull uuids =', pullUuids);
  if (JSON.stringify(pushUuids) !== JSON.stringify(['local-newer', 'local-only'])) {
    throw new Error(`4b/4d failed: expected toPush = [local-newer, local-only], got ${JSON.stringify(pushUuids)}`);
  }
  if (JSON.stringify(pullUuids) !== JSON.stringify(['remote-newer', 'remote-only'])) {
    throw new Error(`4c/4e failed: expected toPull = [remote-newer, remote-only], got ${JSON.stringify(pullUuids)}`);
  }
  // 'unchanged' (identical updatedAt both sides) must appear in neither list.
  if (pushUuids.includes('unchanged') || pullUuids.includes('unchanged')) {
    throw new Error('4f failed: a record with identical updatedAt on both sides should not appear in either list');
  }
  // Whole-record LWW: the winning side's full record content travels, not
  // just its updatedAt - confirms this is per-record, not per-field.
  const wonRecord = plan.toPush.buckets.find((b) => b.uuid === 'local-newer');
  if (wonRecord?.name !== 'Local Version') {
    throw new Error('4d failed: the pushed record should carry the LOCAL side\'s full content, not just win on timestamp');
  }

  // 4g: a tombstone (deletedAt set) with the newer updatedAt beats a live
  // record on the other side - this is what makes "delete on one device,
  // edit on another" resolve consistently with ordinary field-edit
  // conflicts (sync-plan.md §10b).
  const localWithLiveEdit: SyncSnapshot = { ...emptySnapshot(OLD), buckets: [bucket('contested', OLD, { name: 'Edited Locally' })] };
  const remoteWithNewerTombstone: SyncSnapshot = { ...emptySnapshot(OLD), buckets: [bucket('contested', NEW, { deletedAt: NEW })] };
  const tombstonePlan = mergeSnapshots(localWithLiveEdit, remoteWithNewerTombstone);
  console.log('4g: tombstone-beats-live-edit toPull =', tombstonePlan.toPull.buckets.map((b) => ({ uuid: b.uuid, deletedAt: b.deletedAt })));
  if (tombstonePlan.toPull.buckets.length !== 1 || !tombstonePlan.toPull.buckets[0].deletedAt) {
    throw new Error('4g failed: a newer remote tombstone should win over an older local live edit');
  }

  // 4h: settings is a single record (no uuid), not a uuid-keyed collection -
  // whole-record LWW same as everything else, just without a union-of-keys step.
  const settingsLocalNewer = mergeSnapshots(emptySnapshot(NEW), emptySnapshot(OLD));
  const settingsRemoteNewer = mergeSnapshots(emptySnapshot(OLD), emptySnapshot(NEW));
  const settingsEqual = mergeSnapshots(emptySnapshot(OLD), emptySnapshot(OLD));
  console.log('4h: settings local-newer -> push:', !!settingsLocalNewer.toPush.settings, ', pull:', !!settingsLocalNewer.toPull.settings);
  console.log('4h: settings remote-newer -> push:', !!settingsRemoteNewer.toPush.settings, ', pull:', !!settingsRemoteNewer.toPull.settings);
  console.log('4h: settings equal -> push:', !!settingsEqual.toPush.settings, ', pull:', !!settingsEqual.toPull.settings);
  if (!settingsLocalNewer.toPush.settings || settingsLocalNewer.toPull.settings) throw new Error('4h failed: local-newer settings should push, not pull');
  if (settingsRemoteNewer.toPush.settings || !settingsRemoteNewer.toPull.settings) throw new Error('4h failed: remote-newer settings should pull, not push');
  if (settingsEqual.toPush.settings || settingsEqual.toPull.settings) throw new Error('4h failed: equal-timestamp settings should be a no-op both ways');

  console.log('mergeSnapshots: all checks passed');
}
