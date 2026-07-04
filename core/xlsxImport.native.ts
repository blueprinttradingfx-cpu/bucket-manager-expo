// core/xlsxImport.native.ts
// Native (iOS/Android) file import. expo-file-system reads a real file:// /
// content:// URI reliably here - this is the platform it was designed for.
// Row-mapping logic lives in xlsxRows.ts (shared, no native deps) - this
// file only handles picking + reading, native-specific.

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { RawRow } from './bucketLogic';
import { rowsFromWorkbook } from './xlsxRows';

export async function pickStatementFile(): Promise<{ uri: string; name: string } | null> {
  console.log('[xlsxImport.native] opening document picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    copyToCacheDirectory: true,
  });
  console.log('[xlsxImport.native] picker result:', result.canceled ? 'canceled' : result.assets?.[0]?.name);
  if (result.canceled || !result.assets?.[0]) return null;
  return { uri: result.assets[0].uri, name: result.assets[0].name };
}

export async function parseStatementFile(uri: string): Promise<RawRow[]> {
  console.log('[xlsxImport.native] reading file at', uri);
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[xlsxImport.native] read', base64.length, 'base64 chars, parsing workbook');
  const workbook = XLSX.read(base64, { type: 'base64', cellDates: true });
  return rowsFromWorkbook(workbook);
}
