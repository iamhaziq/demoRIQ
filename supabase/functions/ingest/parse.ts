// Read an uploaded CSV/Excel file into header + row objects.
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'
import type { Row } from './clean.ts'

export const MAX_ROWS = 200_000

export interface Sheet {
  headers: string[]
  rows: Row[]
  firstRow: number // spreadsheet row number of rows[0]
}

/**
 * CSV/TSV are read as plain text (raw) so SheetJS never reinterprets "05/10/2026" as a US date;
 * dates are parsed by our own DD/MM rules. In Excel files, date cells arrive as serial numbers.
 * Title rows above the header are skipped: the header is the first of the first 10 rows with
 * at least 2 filled cells.
 */
export function readSheet(bytes: Uint8Array, filename: string): Sheet {
  const isText = /\.(csv|tsv|txt)$/i.test(filename)
  const wb = XLSX.read(bytes, { type: 'array', raw: isText, dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [], firstRow: 2 }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  })

  const filled = (r: unknown[]) => r.filter((v) => v != null && String(v).trim() !== '').length
  let h = matrix.slice(0, 10).findIndex((r) => filled(r) >= 2)
  if (h === -1) h = 0

  const seen = new Map<string, number>()
  const headers = (matrix[h] ?? []).map((v, i) => {
    let name = v == null || String(v).trim() === '' ? `Column ${i + 1}` : String(v).trim()
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    if (n > 1) name = `${name} (${n})`
    return name
  })

  const body = matrix.slice(h + 1)
  if (body.length > MAX_ROWS) throw new Error(`file has ${body.length} rows; the limit is ${MAX_ROWS}`)

  const rows = body.map((r) => Object.fromEntries(headers.map((name, i) => [name, r[i] ?? null])))
  return { headers, rows, firstRow: h + 2 }
}
