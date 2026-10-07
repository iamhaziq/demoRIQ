// Read an uploaded CSV/Excel file into header + row objects. Pure TypeScript with no Deno or Node
// imports: the SheetJS module is passed in, so the ingest Edge Function and the frontend preview
// find the same header row and the same header names.

export type Row = Record<string, unknown>

export interface Sheet {
  headers: string[]
  rows: Row[]
  firstRow: number // spreadsheet row number of rows[0]
}

/** The parts of the SheetJS module this needs (xlsx 0.20.3). */
export interface SheetLib {
  read(data: Uint8Array, opts: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json<T>(ws: unknown, opts: Record<string, unknown>): T[] }
}

/**
 * CSV/TSV are read as plain text (raw) so SheetJS never reinterprets "05/10/2026" as a US date;
 * dates are parsed by our own DD/MM rules. In Excel files, date cells arrive as serial numbers.
 * Title rows above the header are skipped: the header is the first of the first 10 rows with
 * at least 2 filled cells. `maxRows` limits the body (the preview reads only what it shows).
 */
export function readSheet(XLSX: SheetLib, bytes: Uint8Array, filename: string, maxRows = Infinity): Sheet & { totalRows: number } {
  const isText = /\.(csv|tsv|txt)$/i.test(filename)
  const wb = XLSX.read(bytes, { type: 'array', raw: isText, dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [], firstRow: 2, totalRows: 0 }

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
  const rows = body.slice(0, maxRows).map((r) => Object.fromEntries(headers.map((name, i) => [name, r[i] ?? null])))
  return { headers, rows, firstRow: h + 2, totalRows: body.length }
}
