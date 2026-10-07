// Read an uploaded CSV/Excel file into header + row objects (shared logic in _shared/sheet.ts).
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'
import { readSheet as read, type Sheet, type SheetLib } from '../_shared/sheet.ts'

export type { Sheet }
export const MAX_ROWS = 200_000

export function readSheet(bytes: Uint8Array, filename: string): Sheet {
  const { totalRows, ...sheet } = read(XLSX as unknown as SheetLib, bytes, filename)
  if (totalRows > MAX_ROWS) throw new Error(`file has ${totalRows} rows; the limit is ${MAX_ROWS}`)
  return sheet
}
