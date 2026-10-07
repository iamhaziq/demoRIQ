// Upload screen: preview and map a file in the browser, then store it and run the ingest Edge Function.
// Plain module with the client (and SheetJS) passed in, so tests can run it too. The header row and
// the column guesses come from the same shared code the ingest function uses.
import { FIELDS, guessColumns, validateColumnMap } from '../../supabase/functions/_shared/columns.ts'
import { readSheet } from '../../supabase/functions/_shared/sheet.ts'

export const MAX_BYTES = 20 * 1024 * 1024 // raw-uploads bucket limit
export const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls'
export const PREVIEW_ROWS = 20

/** What each field means, in English and Malay, for the mapping screen. */
export const FIELD_LABELS = {
  date: 'Date / Tarikh',
  product: 'Product name / Nama barang',
  sku: 'SKU or barcode / Kod barang',
  qty: 'Units sold / Kuantiti',
  price: 'Selling price per unit / Harga seunit',
  revenue: 'Line total / Jumlah',
  category: 'Category / Kategori',
  on_hand: 'Stock on hand / Baki stok',
  on_order: 'On order / Dalam pesanan',
  unit_cost: 'Cost per unit / Kos seunit',
  unit_price: 'Selling price per unit / Harga jual',
  supplier: 'Supplier / Pembekal',
  lead_time_days: 'Supplier lead time, days / Hari penghantaran',
  pack_size: 'Units per pack / Unit sekotak',
}

export function fieldsFor(kind) {
  return { required: FIELDS[kind].required, optional: FIELDS[kind].optional }
}

/** Reasons the file cannot be read in the browser, or null. */
export function checkFile(file) {
  if (!file) return 'Choose a file first.'
  if (!/\.(csv|tsv|txt|xlsx|xls)$/i.test(file.name)) return 'Use a CSV or Excel file (.csv, .xlsx, .xls).'
  if (file.size > MAX_BYTES) return 'The file is larger than 20 MB. Split it into smaller files.'
  return null
}

/** Headers, the first rows, the row count and guessed columns for a file's bytes. */
export function previewFile(XLSX, bytes, filename, kind) {
  const sheet = readSheet(XLSX, bytes, filename, PREVIEW_ROWS)
  return {
    headers: sheet.headers,
    rows: sheet.rows,
    firstRow: sheet.firstRow,
    totalRows: sheet.totalRows,
    columnMap: guessColumns(sheet.headers, kind),
  }
}

/** Column-map problems in the owner's words (empty when it can be sent). */
export function mapProblems(columnMap, kind, headers) {
  const clean = Object.fromEntries(Object.entries(columnMap).filter(([, h]) => h))
  const used = Object.values(clean)
  const twice = [...new Set(used.filter((h, i) => used.indexOf(h) !== i))]
  return [
    ...validateColumnMap(clean, kind, headers).map((e) =>
      e.replace(/^missing column for (\w+)$/, (_, f) => `Choose the column for ${FIELD_LABELS[f] ?? f}.`)
    ),
    ...twice.map((h) => `"${h}" is chosen for more than one field.`),
  ]
}

/** Error with an optional list of details for the owner. */
export class UploadError extends Error {
  constructor(message, details = []) {
    super(message)
    this.details = details
  }
}

/**
 * Store the original file, record the upload, and run ingest. Resolves to ingest's result
 * { upload_id, rows_ok, rows_rejected, rejected, written, health }.
 */
export async function sendUpload(supabase, shopId, kind, file, columnMap) {
  const name = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = `${shopId}/${crypto.randomUUID()}-${name}`
  const { error: upErr } = await supabase.storage.from('raw-uploads').upload(path, file.bytes, {
    contentType: file.type || 'application/octet-stream',
  })
  if (upErr) throw new UploadError(`The file could not be stored: ${upErr.message}`)

  const { data: row, error: rowErr } = await supabase.from('uploads')
    .insert({ shop_id: shopId, kind, storage_path: path, original_filename: file.name })
    .select('id').single()
  if (rowErr) throw new UploadError(`The upload could not be recorded: ${rowErr.message}`)

  const column_map = Object.fromEntries(Object.entries(columnMap).filter(([, h]) => h))
  const { data, error } = await supabase.functions.invoke('ingest', { body: { upload_id: row.id, column_map } })
  if (error) {
    let body = {}
    try {
      body = (await error.context?.clone?.().json?.()) ?? {}
    } catch {
      // not JSON
    }
    if (error.context?.status === 422) throw new UploadError('The columns do not match the file.', body.details ?? [])
    throw new UploadError(body.error ? `The file could not be loaded: ${body.error}` : 'The file could not be loaded. Please try again.')
  }
  return data
}

/** The latest finished upload (for the health card when the screen opens), or null. */
export async function latestUpload(supabase) {
  const { data, error } = await supabase.from('uploads')
    .select('id, kind, original_filename, rows_ok, rows_rejected, rejected_json, health_json, processed_at')
    .eq('status', 'done').order('processed_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}

const JOB_COLS = 'id, type, status, error, created_at, started_at, finished_at'

/** The shop's most recent ML job, or null. */
export async function latestJob(supabase) {
  const { data, error } = await supabase.from('ml_jobs').select(JOB_COLS)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}

/**
 * Follow the shop's ML jobs live (Realtime; RLS limits it to the caller's shop). Calls onJob with each
 * inserted or updated row. Returns a function that stops listening.
 */
export function watchJobs(supabase, shopId, onJob) {
  const channel = supabase
    .channel(`ml_jobs:${shopId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ml_jobs', filter: `shop_id=eq.${shopId}` },
      (msg) => msg.new && onJob(msg.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/** Newer of two job rows (by created_at, then by the later status). */
export function newerJob(a, b) {
  if (!a) return b
  if (!b) return a
  if (a.id === b.id) return { ...a, ...b }
  return b.created_at > a.created_at ? b : a
}

/** Status line for "Preparing your forecasts". */
export function jobView(job) {
  if (!job) return { phase: 'none', text: 'No forecast run yet.' }
  switch (job.status) {
    case 'queued':
      return { phase: 'queued', text: 'Waiting to start. This usually begins within a minute.' }
    case 'running':
      return { phase: 'running', text: 'Forecasting your products. This takes a few minutes.' }
    case 'succeeded':
      return { phase: 'succeeded', text: 'Your forecasts are ready. Open Today to see what to do.' }
    default:
      return {
        phase: 'failed',
        text: 'This run did not finish. Your data is saved, and forecasts will be updated in tonight\'s run at 2 am.',
        detail: job.error ?? null,
      }
  }
}

/** Data health lines from shop_data_health() (as stored on the upload). Missing values show as '–'. */
export function healthLines(h) {
  if (!h) return []
  const v = (x) => (x === null || x === undefined ? '–' : x)
  return [
    { label: 'Products', value: v(h.products) },
    { label: 'Products with sales', value: v(h.products_with_sales) },
    { label: 'Sales from', value: h.first_date && h.last_date ? `${h.first_date} to ${h.last_date}` : '–' },
    { label: 'Days of sales history', value: v(h.days_of_history) },
    { label: 'Products with 8+ weeks of sales', value: h.pct_products_8_weeks == null ? '–' : `${h.pct_products_8_weeks}%` },
    { label: 'Out-of-stock days recorded', value: v(h.stockout_days) },
  ]
}
