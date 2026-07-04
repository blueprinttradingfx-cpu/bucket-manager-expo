// core/xlsxRows.ts
// Pure XLSX.WorkBook -> RawRow[] mapping. Zero dependency on
// expo-document-picker or expo-file-system - both xlsxImport.native.ts and
// xlsxImport.web.ts import FROM here, never from each other. This is the
// same pattern as bucketLogic.ts being the shared core both db.native.ts
// and db.web.ts depend on - a platform file should never import another
// platform file directly, or Metro may bundle native-only code into the
// web build (or vice versa).

import * as XLSX from 'xlsx';
import { RawRow, TxnType } from './bucketLogic';

export function rowsFromWorkbook(workbook: XLSX.WorkBook): RawRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<any>(sheet, { raw: true });
  console.log('[xlsxRows] parsed', json.length, 'rows from sheet', workbook.SheetNames[0]);

  return json.map((r) => ({
    Date: formatDate(r['Date']),
    Type: r['Type'] as TxnType,
    Stock: r['Stock'] ?? null,
    Description: r['Description'] ?? null,
    Quantity: r['Quantity'] ?? null,
    Price: r['Price'] ?? null,
    'Comm & Other Fees': r['Comm & Other Fees'] ?? null,
    Currency: r['Currency'] ?? null,
    Amount: r['Amount'] ?? null,
  }));
}

function formatDate(v: any): string {
  // Real-world case, confirmed against actual DragonFi exports: the Date
  // cell comes back as a STRING already in DD/MM/YYYY, not a JS Date -
  // cellDates:true has no effect because the source cells are text-
  // formatted, not real Excel date cells. Passing this through new Date()
  // is unreliable (JS guesses MM/DD/YYYY for slash-separated strings,
  // which either fails outright when day > 12, or silently swaps day/month
  // when day <= 12) - this was a real, previously-undetected bug.
  if (typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v.trim())) {
    return v.trim();
  }
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, '0');
    const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${v.getUTCFullYear()}`;
  }
  if (typeof v === 'number') {
    // Excel date serial - only path if DragonFi ever ships real date-typed cells.
    const parsed: any = XLSX.SSF.parse_date_code(v);
    const dd = String(parsed.d).padStart(2, '0');
    const mm = String(parsed.m).padStart(2, '0');
    return `${dd}/${mm}/${parsed.y}`;
  }
  throw new Error(`Unrecognized date cell value: ${JSON.stringify(v)} (type ${typeof v})`);
}
