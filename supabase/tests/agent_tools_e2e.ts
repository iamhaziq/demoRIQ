// End-to-end check of the agent's database tools against the LOCAL stack (no Gemini calls).
//   npx supabase start
//   deno run -A supabase/tests/agent_tools_e2e.ts
// Seeds one shop with deck-based decisions/forecasts, runs every tool as that user, and checks a
// second user sees none of it.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { dbTools } from '../functions/agent-ask/tools.ts'

const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
const url: string = status.API_URL
if (!url.includes('127.0.0.1') && !url.includes('localhost')) throw new Error('local stack only')
const admin = createClient(url, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY

async function signUp() {
  const email = `agent-${crypto.randomUUID().slice(0, 8)}@test.my`
  const password = crypto.randomUUID()
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const db = createClient(url, anonKey)
  const { error: e2 } = await db.auth.signInWithPassword({ email, password })
  if (e2) throw e2
  const { data: shopId } = await db.rpc('current_shop_id')
  return { db, shopId: shopId as string }
}

const one = async <T>(q: PromiseLike<{ data: T | null; error: unknown }>) => {
  const { data, error } = await q
  if (error) throw error
  return data as T
}

const { db, shopId } = await signUp()
const products = await one<{ id: string; name: string }[]>(admin.from('products').insert([
  { shop_id: shopId, name: 'Milo 1kg', sku: 'MILO1', unit_cost: 0.59 },
  { shop_id: shopId, name: 'Kopi Tongkat 200g', unit_cost: 8.8, holding_days: 180 },
  { shop_id: shopId, name: 'Kopi O Kaw 1kg', unit_cost: 12 },
  { shop_id: shopId, name: 'Roti Gardenia' },
]).select('id, name'))
const id = (n: string) => products.find((p) => p.name === n)!.id

const mv = await one<{ id: string }>(admin.from('model_versions').insert({
  shop_id: shopId, version: 3, model_type: 'lightgbm', wape: 0.2134, baseline_wape: 0.241, status: 'champion',
  metrics_json: { trained_through: '2026-10-05' },
}).select('id').single())

await one(admin.from('forecasts').insert([0, 7, 14, 21].map((d, i) => ({
  shop_id: shopId, product_id: id('Milo 1kg'), model_version_id: mv.id,
  week_start: new Date(Date.UTC(2026, 9, 7 + d)).toISOString().slice(0, 10),
  p10: 120 + i, p50: 144.75, p90: 170 + i, low_confidence: false,
}))).select('product_id'))
await one(admin.from('forecasts').insert({
  shop_id: shopId, product_id: id('Roti Gardenia'), model_version_id: mv.id, week_start: '2026-10-07',
  p10: 1, p50: 3, p90: 6, low_confidence: true,
}).select('product_id'))

const trueCostMilo = { stock_value: 54.28, cost_per_day: 0.07, annual_cost: 26.75 }
const trueCostKopi = { stock_value: 1540, cost_per_day: 1.67, annual_cost: 610.2 }
await one(admin.from('decisions').insert([
  { shop_id: shopId, product_id: id('Milo 1kg'), model_version_id: mv.id, type: 'REORDER', qty: 306, value_rm: 180.54,
    reason_json: { true_cost: trueCostMilo, reorder: { days_of_cover: 4.45, lead_time_days: 7, safety_stock: 108.05 } } },
  { shop_id: shopId, product_id: id('Kopi Tongkat 200g'), model_version_id: mv.id, type: 'CLEAR', qty: 175, value_rm: 1496.88,
    reason_json: { true_cost: trueCostKopi, hold_or_clear: { discount_pct: 10, break_even_discount_pct: 34.5, cash_released: 1496.88 } } },
  // an old, superseded decision must never be shown
  { shop_id: shopId, product_id: id('Milo 1kg'), model_version_id: mv.id, type: 'REORDER', qty: 999, value_rm: 9999,
    reason_json: {}, superseded_at: new Date().toISOString() },
]).select('id'))

const tools = dbTools(db, '2026-10-07')

const actions = await tools.run('get_todays_actions', {}) as any
assertEquals(actions.actions.map((a: any) => [a.type, a.product, a.value_rm]),
  [['CLEAR', 'Kopi Tongkat 200g', 1496.88], ['REORDER', 'Milo 1kg', 180.54]])
assertEquals(actions.source, { model_version: 3, model_type: 'lightgbm', trained_through: '2026-10-05', run_date: actions.source.run_date })

const reorder = await tools.run('get_reorder', { product: 'milo' }) as any
assertEquals([reorder.product, reorder.decision, reorder.qty, reorder.cash_required], ['Milo 1kg', 'REORDER', 306, 180.54])
assertEquals((await tools.run('get_reorder', { product: 'MILO1' }) as any).product, 'Milo 1kg') // by SKU
assertEquals((await tools.run('get_reorder', { product: 'Kopi Tongkat' }) as any).decision, 'NO_REORDER_NEEDED')

const clear = await tools.run('get_clearance', { product: 'kopi tongkat' }) as any
assertEquals([clear.decision, clear.details.discount_pct], ['CLEAR', 10])

const kopi = await tools.run('get_clearance', { product: 'kopi' }) as any
assertEquals(kopi.error, 'ambiguous_product') // two kopi products, neither clearly better
assertEquals((await tools.run('get_reorder', { product: 'Nescafe Classic' }) as any).error, 'product_not_found')

const slow = await tools.run('get_true_cost', { product: 'slow_stock' }) as any
assertEquals([slow.products, slow.total_stock_value, slow.total_cost_per_day, slow.total_annual_cost], [1, 1540, 1.67, 610.2])
assertEquals((await tools.run('get_true_cost', { product: 'Milo 1kg' }) as any).true_cost, trueCostMilo)

const fc = await tools.run('get_forecast', { product: 'Milo' }) as any
assertEquals([fc.weeks, fc.forecast[0].likely, fc.low_confidence], [4, 144.75, false])
assertEquals((await tools.run('get_forecast', { product: 'Roti' }) as any).low_confidence, true)

const found = await tools.run('find_product', { name: 'kopi' }) as any
assertEquals(found.matches.map((m: any) => m.name).sort(), ['Kopi O Kaw 1kg', 'Kopi Tongkat 200g'])

const st = await tools.run('get_data_status', {}) as any
assertEquals([st.model.version, st.model.wape_pct, st.low_confidence_products], [3, 21.34, 1])

// Another shop's owner sees nothing.
const other = dbTools((await signUp()).db, '2026-10-07')
assertEquals((await other.run('get_todays_actions', {}) as any).actions, [])
assertEquals((await other.run('get_reorder', { product: 'Milo 1kg' }) as any).error, 'product_not_found')
assert((await other.run('get_data_status', {}) as any).model === null)

console.log('AGENT TOOLS E2E PASS')

// The HTTP endpoint (needs `npx supabase functions serve`). Works with or without Gemini:
// if the model is unavailable the answer is the templated one built from the same data.
const ask = async (question: string) => {
  const { data, error } = await db.functions.invoke('agent-ask', { body: { question } })
  if (error) throw new Error(`agent-ask failed: ${await error.context?.text?.() ?? error.message}`)
  return data as { answer: string; language: string; fallback: boolean; tools: string[] }
}
const a1 = await ask('Apa nak buat hari ni?')
assertEquals(a1.language, 'ms')
assert(a1.answer.length > 0)
assertEquals((await one<unknown[]>(db.from('agent_logs').select('id'))).length, 0) // no consent, no log
await one(db.from('shops').update({ agent_log_consent: true }).eq('id', shopId).select('id'))
const a2 = await ask('What should I do today?')
const logs = await one<{ question: string; fallback: string | null }[]>(db.from('agent_logs').select('question, fallback'))
assertEquals(logs.map((l) => l.question), ['What should I do today?'])
console.log('AGENT ENDPOINT PASS', JSON.stringify({ fallback: a2.fallback, reason: logs[0].fallback?.slice(0, 60), answer: a2.answer.split('\n')[0] }))
