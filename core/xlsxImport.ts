// core/xlsxImport.ts
// Reads a DragonFi Statement of Account (.xlsx) picked from the device.
// RN has no filesystem access like Node, so the pattern is: pick file ->
// read as base64 via expo-file-system -> hand base64 to SheetJS with
// {type: 'base64'}. This is the standard working pattern for xlsx-in-RN;
// noting it explicitly since it's not obvious coming from Node/browser usage.

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { RawRow, TxnType } from './bucketLogic';

/** Opens the native file picker, returns null if the user cancels. */
export async function pickStatementFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls, in case DragonFi ever changes format
    ],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return { uri: result.assets[0].uri, name: result.assets[0].name };
}

/** Reads a picked xlsx file and returns parsed rows matching the DragonFi schema. */
export async function parseStatementFile(uri: string): Promise<RawRow[]> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const workbook = XLSX.read(base64, { type: 'base64', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<any>(sheet, { raw: true });

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
  const dt: Date = v instanceof Date ? v : new Date(v);
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
