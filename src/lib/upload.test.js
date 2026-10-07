// deno test src/lib  (fake client; real SheetJS 0.20.3 from node_modules, so `npm ci` first; no network)
import { assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import * as XLSX from '../../node_modules/xlsx/xlsx.mjs'
import { healthLines, jobView, mapProblems, newerJob, previewFile, sendUpload, UploadError } from './upload.js'

const sample = await Deno.readFile(new URL('../../data/samples/kedai_sales_messy.csv', import.meta.url))

Deno.test('preview skips the title row, keeps the file\'s header names and guesses the Malay columns', () => {
  const p = previewFile(XLSX, sample, 'kedai_sales_messy.csv', 'sales')
  assertEquals(p.headers, ['Tarikh', 'Nama Barang', 'Kuantiti', 'Harga (RM)', 'Catatan'])
  assertEquals(p.firstRow, 3) // spreadsheet row of the first data row
  assertEquals(p.totalRows, 16) // 15 data rows + 1 blank row after the header (ingest: 9 loaded, 6 rejected, blank skipped)
  assertEquals(p.rows[0], { Tarikh: '01/10/2026', 'Nama Barang': 'Milo 1kg', Kuantiti: '2', 'Harga (RM)': 'RM21.00', Catatan: null })
  assertEquals(p.columnMap, { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', price: 'Harga (RM)' })
})

Deno.test('column problems: a missing required field and a column used twice', () => {
  const headers = ['Tarikh', 'Nama Barang', 'Kuantiti']
  assertEquals(mapProblems({ date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti' }, 'sales', headers), [])
  assertEquals(mapProblems({ date: 'Tarikh', product: 'Nama Barang', qty: '' }, 'sales', headers), [
    'Choose the column for Units sold / Kuantiti.',
  ])
  assertEquals(mapProblems({ date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', sku: 'Kuantiti' }, 'sales', headers), [
    '"Kuantiti" is chosen for more than one field.',
  ])
})

function fakeClient(invokeResult) {
  const calls = []
  return {
    calls,
    storage: { from: (b) => ({ upload: (path, bytes, o) => (calls.push(['upload', b, path, o.contentType]), Promise.resolve({ error: null })) }) },
    from: (t) => ({
      insert: (row) => ({
        select: () => ({ single: () => (calls.push(['insert', t, row]), Promise.resolve({ data: { id: 'u1' }, error: null })) }),
      }),
    }),
    functions: { invoke: (name, o) => (calls.push(['invoke', name, o.body]), Promise.resolve(invokeResult)) },
  }
}
const file = { name: 'jualan okt.csv', type: 'text/csv', bytes: sample }

Deno.test('send stores the file under the shop folder, records the upload, and runs ingest with the non-empty columns', async () => {
  const ok = { upload_id: 'u1', rows_ok: 9, rows_rejected: 6, rejected: [], health: { products: 5 } }
  const sb = fakeClient({ data: ok, error: null })
  assertEquals(await sendUpload(sb, 'shop1', 'sales', file, { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', sku: undefined }), ok)
  const [up, ins, inv] = sb.calls
  assertEquals([up[0], up[1], up[3]], ['upload', 'raw-uploads', 'text/csv'])
  assertMatch(up[2], /^shop1\/[0-9a-f-]{36}-jualan okt\.csv$/)
  assertEquals(ins, ['insert', 'uploads', { shop_id: 'shop1', kind: 'sales', storage_path: up[2], original_filename: 'jualan okt.csv' }])
  assertEquals(inv, ['invoke', 'ingest', { upload_id: 'u1', column_map: { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti' } }])
})

Deno.test('ingest errors: column mismatch lists the details; others carry the server message', async () => {
  const http = (status, body) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } })
  const e1 = await assertRejects(() => sendUpload(fakeClient(http(422, { details: ['missing column for qty'] })), 's', 'sales', file, {}), UploadError)
  assertEquals([e1.message, e1.details], ['The columns do not match the file.', ['missing column for qty']])
  const e2 = await assertRejects(() => sendUpload(fakeClient(http(500, { error: 'could not save rows: x' })), 's', 'sales', file, {}), UploadError)
  assertEquals(e2.message, 'The file could not be loaded: could not save rows: x')
})

Deno.test('job status: the newest job wins and updates to the same job merge', () => {
  const a = { id: 'j1', status: 'queued', created_at: '2026-10-07T01:00:00Z' }
  assertEquals(newerJob(a, { id: 'j1', status: 'running' }).status, 'running')
  assertEquals(newerJob(a, { id: 'j0', status: 'succeeded', created_at: '2026-10-06T01:00:00Z' }).id, 'j1')
  assertEquals(newerJob(null, a), a)
  assertEquals(jobView(null).phase, 'none')
  assertEquals(jobView({ status: 'failed', error: 'ML service is not configured' }).detail, 'ML service is not configured')
  assertMatch(jobView({ status: 'succeeded' }).text, /ready/)
})

Deno.test('health lines show stored values; missing ones are a dash, not 0', () => {
  const lines = healthLines({ products: 5, products_with_sales: 4, first_date: '2026-10-01', last_date: '2026-10-05',
    days_of_history: 5, pct_products_8_weeks: 0, stockout_days: null })
  assertEquals(lines.map((l) => l.value), [5, 4, '2026-10-01 to 2026-10-05', 5, '0%', '–'])
  assertEquals(healthLines(null), [])
})
