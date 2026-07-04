// core/xlsxImport.web.ts
// Web file import. Deliberately bypasses expo-file-system for reading -
// its readAsStringAsync targets native file:// / content:// URIs and has
// weak support for the blob: URLs a browser file picker actually returns,
// which is the most likely cause of the original silent-failure report.
//
// Uses a plain <input type="file"> + the browser's native File.arrayBuffer()
// instead - the standard, reliable way to read a picked file in a browser.
// Keeps the SAME function signatures as xlsxImport.native.ts (pickStatementFile
// returning a {uri, name}, parseStatementFile taking that uri) so ImportScreen.tsx
// needs zero platform-specific code - the picked File object is cached in
// memory, keyed by a synthetic uri, exactly the same pattern used to hide
// the SQLite/IndexedDB split behind one BucketStoreAPI interface.

import * as XLSX from 'xlsx';
import { RawRow } from './bucketLogic';
import { rowsFromWorkbook } from './xlsxRows';

const fileCache = new Map<string, File>();

export async function pickStatementFile(): Promise<{ uri: string; name: string } | null> {
  console.log('[xlsxImport.web] opening browser file picker');
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        console.log('[xlsxImport.web] no file selected (dialog closed without a pick)');
        resolve(null);
        return;
      }
      const uri = `webfile://${Date.now()}-${file.name}`;
      fileCache.set(uri, file);
      console.log('[xlsxImport.web] picked', file.name, `(${file.size} bytes)`);
      resolve({ uri, name: file.name });
    };

    // Some browsers only fire 'change' - 'cancel' isn't universally supported,
    // so a dialog-dismiss with no selection is handled by onchange firing
    // with an empty file list above, not a separate cancel handler.
    document.body.appendChild(input);
    input.click();
  });
}

export async function parseStatementFile(uri: string): Promise<RawRow[]> {
  const file = fileCache.get(uri);
  if (!file) {
    throw new Error(`No cached file for ${uri} - this shouldn't happen; picker and parser got out of sync`);
  }
  console.log('[xlsxImport.web] reading', file.name, 'via File.arrayBuffer()');
  const buffer = await file.arrayBuffer();
  console.log('[xlsxImport.web] read', buffer.byteLength, 'bytes, parsing workbook');
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  fileCache.delete(uri);
  return rowsFromWorkbook(workbook);
}
