// ingest: validate and load one uploaded sales/stock file for the caller's shop.
// Runs with the caller's JWT, so RLS limits every read and write to their shop.
// Request: POST { upload_id: string, column_map: ColumnMap }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { type ColumnMap, type Kind, validateColumnMap } from '../_shared/columns.ts'
import { cleanSales, cleanStock, todayMYT } from './clean.ts'
import { readSheet } from './parse.ts'

const MAX_REJECTED_STORED = 500
const MAX_REJECTED_RETURNED = 50

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'not signed in' })

  let body: { upload_id?: string; column_map?: ColumnMap }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'body must be JSON' })
  }
  const { upload_id, column_map } = body
  if (!upload_id || !column_map || typeof column_map !== 'object') {
    return json(400, { error: 'upload_id and column_map are required' })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  // RLS: only the caller's own uploads are visible.
  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .select('id, kind, storage_path, original_filename, status')
    .eq('id', upload_id)
    .maybeSingle()
  if (uploadErr) return json(500, { error: uploadErr.message })
  if (!upload) return json(404, { error: 'upload not found' })
  if (upload.status === 'processing') return json(409, { error: 'upload is already being processed' })
  if (upload.kind !== 'sales' && upload.kind !== 'stock') {
    return json(400, { error: `unsupported upload kind: ${upload.kind}` })
  }
  const kind = upload.kind as Kind

  const setUpload = (fields: Record<string, unknown>) =>
    supabase.from('uploads').update(fields).eq('id', upload_id)

  await setUpload({ status: 'processing', column_map_json: column_map, error: null })

  try {
    const { data: file, error: dlErr } = await supabase.storage.from('raw-uploads').download(upload.storage_path)
    if (dlErr || !file) throw new Error(`could not read the uploaded file: ${dlErr?.message ?? 'missing'}`)

    const sheet = readSheet(new Uint8Array(await file.arrayBuffer()), upload.original_filename ?? upload.storage_path)
    const mapErrors = validateColumnMap(column_map, kind, sheet.headers)
    if (mapErrors.length) {
      await setUpload({ status: 'failed', error: mapErrors.join('; ') })
      return json(422, { error: 'column map does not match the file', details: mapErrors, headers: sheet.headers })
    }

    const today = todayMYT()
    const cleaned = kind === 'sales'
      ? cleanSales(sheet.rows, column_map, today, sheet.firstRow)
      : cleanStock(sheet.rows, column_map, today, sheet.firstRow)

    const { data: written, error: commitErr } = await supabase.rpc('ingest_commit', {
      p_products: cleaned.products,
      p_sales: cleaned.sales,
      p_stock: cleaned.stock,
    })
    if (commitErr) throw new Error(`could not save rows: ${commitErr.message}`)

    const { data: health, error: healthErr } = await supabase.rpc('shop_data_health')
    if (healthErr) throw new Error(`could not compute data health: ${healthErr.message}`)

    await setUpload({
      status: 'done',
      rows_ok: cleaned.rowsOk,
      rows_rejected: cleaned.rejected.length,
      rejected_json: cleaned.rejected.slice(0, MAX_REJECTED_STORED),
      health_json: health,
      processed_at: new Date().toISOString(),
    })

    // Hand off to trigger-ml so new data gets forecasts within minutes. Runs after the response;
    // a failure here only delays forecasts until the nightly run.
    const handoff = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/trigger-ml`, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'predict' }),
    }).then((r) => r.body?.cancel()).catch((e) => console.error('trigger-ml hand-off failed', e))
    ;(globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(handoff)

    return json(200, {
      upload_id,
      rows_ok: cleaned.rowsOk,
      rows_rejected: cleaned.rejected.length,
      rejected: cleaned.rejected.slice(0, MAX_REJECTED_RETURNED),
      written,
      health,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await setUpload({ status: 'failed', error: message })
    return json(500, { error: message })
  }
})
