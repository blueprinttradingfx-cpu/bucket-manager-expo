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
}

main().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
