// Forecast screen queries (src/lib/forecastData.js) against a pipeline-filled shop on the LOCAL stack.
//   cd ml && .venv/Scripts/python scripts/local_predict.py     -> "LOCAL PREDICT PASS <shop_id>"
//   deno run -A --config supabase/functions/deno.json supabase/tests/forecast_e2e.ts <shop_id>
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { loadForecastProducts, loadProductForecast } from '../../src/lib/forecastData.js'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: forecast_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY

// Hand the seeded shop to a real, signed-in user (the Python seed has no login).
const email = `forecast-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw error
await admin.from('shops').delete().eq('owner_user_id', created.user.id)
await admin.from('shops').update({ owner_user_id: created.user.id }).eq('id', shopId)
const db = createClient(status.API_URL, anon, { auth: { persistSession: false } })
await db.auth.signInWithPassword({ email, password })

// The picker opens on the largest current reorder.
const { products, defaultId } = await loadForecastProducts(db)
const top = (await admin.from('decisions').select('product_id, qty, value_rm').eq('shop_id', shopId).eq('type', 'REORDER')
  .is('superseded_at', null).order('value_rm', { ascending: false }).limit(1).single()).data
assert(products.length > 0)
assertEquals(defaultId, top.product_id)

const f = await loadProductForecast(db, defaultId)
const forecast = f.rows.filter((r) => r.p50 !== undefined)
const history = f.rows.filter((r) => r.units !== undefined)
assertEquals(forecast.length, 28, '28 daily forecast rows')
assert(history.length > 0 && history.length <= 120, 'up to 120 days of sales')
assert(history.every((r) => r.date <= f.asOf) && forecast.every((r) => r.date > f.asOf))
assert(forecast.every((r) => r.p10 <= r.p50 && r.p50 <= r.p90))
assertEquals([f.panel.orderQty, f.panel.cashRequired], [Number(top.qty), Number(top.value_rm)])
assert(['High', 'Medium', 'Low'].includes(f.panel.confidence), 'confidence stored per product')
assert(f.panel.source.startsWith('model v'))
console.log(f.product.name, f.panel, `${history.length} sales days, ${forecast.length} forecast days`)

// A product with no REORDER decision: forecast and confidence still shown, no order needed.
const reorderIds = new Set(((await admin.from('decisions').select('product_id').eq('shop_id', shopId).eq('type', 'REORDER')
  .is('superseded_at', null)).data ?? []).map((d) => d.product_id))
const other = products.find((p) => !reorderIds.has(p.id))
if (other) {
  const o = await loadProductForecast(db, other.id)
  assertEquals([o.panel.orderQty, o.panel.cashRequired], [0, null])
  assert(o.panel.p50 !== null && o.panel.confidence)
  console.log(other.name, o.panel)
}

// Another shop's user sees no products and gets nothing for this product id.
const stranger = createClient(status.API_URL, anon, { auth: { persistSession: false } })
const e2 = `other-${crypto.randomUUID().slice(0, 8)}@test.my`
await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
await stranger.auth.signInWithPassword({ email: e2, password })
assertEquals((await loadForecastProducts(stranger)).products, [])
const s = await loadProductForecast(stranger, defaultId)
assertEquals([s.product, s.rows, s.panel.p50], [null, [], null])
console.log('FORECAST E2E PASS')
