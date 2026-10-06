// End-to-end check of the ingest flow against the LOCAL stack.
// 1) npx supabase start   2) npx supabase functions serve   3) in another terminal:
//    deno run -A supabase/tests/ingest_e2e.ts
// Uses the local stack's keys from `supabase status`; never point this at production.
import { createClient } from 'npm:@supabase/supabase-js@2'

const status = JSON.parse(
  new TextDecoder().decode(
    (await new Deno.Command(Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', {
      args: ['supabase', 'status', '-o', 'json'],
      stderr: 'null',
    }).output()).stdout,
  ),
)
const url: string = status.API_URL
if (!url.includes('127.0.0.1') && !url.includes('localhost')) throw new Error('local stack only')

const admin = createClient(url, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const email = `e2e-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (createErr) throw createErr

const db = createClient(url, status.ANON_KEY ?? status.PUBLISHABLE_KEY)
const { error: signInErr } = await db.auth.signInWithPassword({ email, password })
if (signInErr) throw signInErr

const { data: shopId } = await db.rpc('current_shop_id')
const file = await Deno.readFile(new URL('../../data/samples/kedai_sales_messy.csv', import.meta.url))
const path = `${shopId}/${crypto.randomUUID()}-kedai_sales_messy.csv`
const { error: upErr } = await db.storage.from('raw-uploads').upload(path, file, { contentType: 'text/csv' })
if (upErr) throw upErr

const { data: upload, error: rowErr } = await db
  .from('uploads')
  .insert({ shop_id: shopId, kind: 'sales', storage_path: path, original_filename: 'kedai_sales_messy.csv' })
  .select('id')
  .single()
if (rowErr) throw rowErr

const column_map = { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', price: 'Harga (RM)' }
const { data, error } = await db.functions.invoke('ingest', { body: { upload_id: upload.id, column_map } })
if (error) throw new Error(`ingest failed: ${await error.context?.text?.() ?? error.message}`)

console.log(JSON.stringify({ ...data, rejected: data.rejected.map((r: { row: number; reason: string }) => `${r.row}: ${r.reason}`) }, null, 2))

const { count } = await db.from('sales').select('*', { count: 'exact', head: true })
const { data: saved } = await db.from('uploads').select('status, rows_ok, rows_rejected').eq('id', upload.id).single()
const ok = data.rows_ok === 9 && data.rows_rejected === 6 && count === 8 && saved?.status === 'done'
console.log(ok ? 'E2E PASS' : `E2E FAIL (sales rows=${count}, upload=${JSON.stringify(saved)})`)

// Another user must not be able to ingest this upload.
const other = createClient(url, status.ANON_KEY ?? status.PUBLISHABLE_KEY)
const email2 = `e2e-${crypto.randomUUID().slice(0, 8)}@test.my`
await admin.auth.admin.createUser({ email: email2, password, email_confirm: true })
await other.auth.signInWithPassword({ email: email2, password })
const { error: crossErr } = await other.functions.invoke('ingest', { body: { upload_id: upload.id, column_map } })
const crossStatus = crossErr?.context?.status
console.log(crossStatus === 404 ? 'CROSS-SHOP PASS (404)' : `CROSS-SHOP FAIL (${crossStatus})`)

// The upload hands off to trigger-ml (runs after the response): a job row appears for this shop.
// Locally Modal is not configured, so it is marked failed with that reason.
let job: { type: string; status: string; error: string | null } | null = null
for (let i = 0; i < 20 && job?.status !== 'failed' && job?.status !== 'succeeded'; i++) {
  await new Promise((r) => setTimeout(r, 500))
  job = (await db.from('ml_jobs').select('type, status, error').maybeSingle()).data
}
const handoffOk = job?.type === 'predict' &&
  (job.status !== 'failed' || job.error === 'ML service is not configured')
console.log(handoffOk ? `HANDOFF PASS (${job?.status}: ${job?.error ?? 'queued'})` : `HANDOFF FAIL (${JSON.stringify(job)})`)

Deno.exit(ok && crossStatus === 404 && handoffOk ? 0 : 1)
