// Stock Cost screen queries (src/lib/stockCostData.js) against a pipeline-filled shop on the LOCAL stack.
//   cd ml && .venv/Scripts/python scripts/local_predict.py     -> "LOCAL PREDICT PASS <shop_id>"
//   deno run -A --config supabase/functions/deno.json supabase/tests/stock_cost_e2e.ts <shop_id>
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { loadStockCost } from '../../src/lib/stockCostData.js'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: stock_cost_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY

// Hand the seeded shop to a real, signed-in user (the Python seed has no login).
const email = `cost-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw error
await admin.from('shops').delete().eq('owner_user_id', created.user.id)
await admin.from('shops').update({ owner_user_id: created.user.id }).eq('id', shopId)
const db = createClient(status.API_URL, anon, { auth: { persistSession: false } })
await db.auth.signInWithPassword({ email, password })

const s = await loadStockCost(db)
const stored = (await admin.from('product_metrics').select('product_id, cost_per_day, annual_cost, stock_value, slow_stock')
  .eq('shop_id', shopId)).data!
assertEquals(s.rows.length, stored.length, 'every product with metrics is listed')
for (let i = 1; i < s.rows.length; i++) assert(s.rows[i - 1].costPerDay! >= s.rows[i].costPerDay!, 'highest cost per day first')
for (const r of s.rows) {
  const m = stored.find((x) => x.product_id === r.id)!
  assertEquals([r.costPerDay, r.stockValue, r.slow], [Number(m.cost_per_day), Number(m.stock_value), m.slow_stock])
  assertEquals(s.details[r.id].horizon.d365, Number(m.annual_cost))
}
console.log(s.rows.map((r) => `${r.name}: RM${r.costPerDay}/day${r.slow ? ' (slow)' : ''}`).join(', '))

// Slow stock has the hold-or-clear slider, matching its current CLEAR/HOLD decision; selling stock does not.
const hc = (await admin.from('decisions').select('product_id, value_rm, type, reason_json').eq('shop_id', shopId)
  .in('type', ['CLEAR', 'HOLD']).is('superseded_at', null)).data!
assert(hc.length > 0, 'the seeded shop has slow stock')
for (const d of hc) {
  const h = s.details[d.product_id].hold!
  assertEquals(h.rows.length, 10, 'sell-through 50%..95%')
  assertEquals(h.rows[h.start].sellThrough, d.reason_json.hold_or_clear.clearance_sell_through_assumed)
  assertEquals(h.holdingCostTotal, d.reason_json.hold_or_clear.holding_cost_total)
  console.log(d.type, h.rows[h.start])
}
for (const r of s.rows.filter((r) => !hc.some((d) => d.product_id === r.id))) assertEquals(s.details[r.id].hold, null)

// Another shop's user sees an empty screen.
const stranger = createClient(status.API_URL, anon, { auth: { persistSession: false } })
const e2 = `other-${crypto.randomUUID().slice(0, 8)}@test.my`
await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
await stranger.auth.signInWithPassword({ email: e2, password })
assertEquals((await loadStockCost(stranger)).rows, [])
console.log('STOCK COST E2E PASS')
