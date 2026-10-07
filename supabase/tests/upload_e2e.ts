// Upload screen (src/lib/upload.js) against the LOCAL stack: preview, store, ingest, data health, and live
// ML job status over Realtime. Needs the local stack with Edge Functions running.
//   deno run -A --config supabase/functions/deno.json supabase/tests/upload_e2e.ts
// Locally trigger-ml has no Modal config, so the job ingest queues fails at once; the test then moves a
// job through queued -> running -> succeeded itself (as Modal would) and checks the owner sees each step.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import * as XLSX from '../../node_modules/xlsx/xlsx.mjs'
import { latestJob, latestUpload, previewFile, sendUpload, watchJobs } from '../../src/lib/upload.js'

const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY

async function newOwner(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.my`
  const password = crypto.randomUUID()
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const db = createClient(status.API_URL, anon, { auth: { persistSession: false } })
  await db.auth.signInWithPassword({ email, password })
  db.realtime.setAuth((await db.auth.getSession()).data.session!.access_token)
  const { data: shopId } = await db.rpc('current_shop_id')
  return { db, shopId: shopId as string }
}

const owner = await newOwner('upload')
const stranger = await newOwner('other')

// Both listen before anything happens; only the owner may hear about the owner's jobs.
const seen: { status: string; id: string }[] = []
const leaked: unknown[] = []
const stop = watchJobs(owner.db, owner.shopId, (j) => seen.push({ id: j.id, status: j.status }))
const stop2 = watchJobs(stranger.db, owner.shopId, (j) => leaked.push(j)) // even when asking for the owner's shop id
await new Promise((r) => setTimeout(r, 1500)) // let both channels subscribe

// 1. Preview in the browser: header row and guessed columns.
const bytes = await Deno.readFile(new URL('../../data/samples/kedai_sales_messy.csv', import.meta.url))
const p = previewFile(XLSX, bytes, 'kedai_sales_messy.csv', 'sales')
assertEquals(p.columnMap, { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', price: 'Harga (RM)' })

// 2. Store + ingest with the guessed map: same result as ingest_e2e (9 rows loaded, 6 skipped).
const r = await sendUpload(owner.db, owner.shopId, 'sales', { name: 'kedai_sales_messy.csv', type: 'text/csv', bytes }, p.columnMap)
assertEquals([r.rows_ok, r.rows_rejected], [9, 6])
assert(r.rejected.every((x: { row: number; reason: string }) => x.row >= 3 && x.reason))
assertEquals(r.health.products, 4)
const last = await latestUpload(owner.db)
assertEquals([last.rows_ok, last.health_json.days_of_history], [9, r.health.days_of_history])
console.log('health:', r.health, '\nskipped:', r.rejected.map((x: { row: number; reason: string }) => `${x.row}: ${x.reason}`))

// 3. ingest hands off to trigger-ml after responding; locally that job fails (no Modal config).
let first = null
for (let i = 0; i < 20 && !first?.finished_at; i++) {
  await new Promise((res) => setTimeout(res, 500))
  first = await latestJob(owner.db)
}
assert(first, 'ingest queued a forecast job')
console.log('hand-off job:', first.status, first.error)

// 4. A job moving as Modal moves it: every step reaches the owner live.
const { data: job } = await admin.from('ml_jobs').insert({ shop_id: owner.shopId, type: 'predict' }).select('id').single()
await admin.from('ml_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job!.id)
await admin.from('ml_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', job!.id)
for (let i = 0; i < 20 && !seen.some((s) => s.id === job!.id && s.status === 'succeeded'); i++) {
  await new Promise((res) => setTimeout(res, 250))
}
const steps = seen.filter((s) => s.id === job!.id).map((s) => s.status)
console.log('live steps:', steps)
assertEquals(steps, ['queued', 'running', 'succeeded'])
assertEquals(leaked, [], 'another shop receives nothing')
assertEquals((await latestJob(stranger.db)), null)

await stop()
await stop2()
console.log('UPLOAD E2E PASS')
Deno.exit(0)
