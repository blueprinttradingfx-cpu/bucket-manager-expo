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
