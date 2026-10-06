// The agent's tools read what the ML pipeline wrote (reason_json contract), on the LOCAL stack.
//   cd ml && .venv/Scripts/python scripts/local_predict.py      -> prints "LOCAL PREDICT PASS <shop_id>"
//   deno run -A --config supabase/functions/deno.json supabase/tests/agent_on_pipeline_e2e.ts <shop_id>
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { renderFromResults } from '../functions/agent-ask/templates.ts'
import { checkNumbers } from '../functions/agent-ask/guardrail.ts'
import { dbTools } from '../functions/agent-ask/tools.ts'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: agent_on_pipeline_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)

// The Python seed inserts a bare auth.users row (no login). Create a real user, drop the empty shop
// its signup trigger made, and hand the seeded shop to it.
const email = `pipeline-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (cErr) throw cErr
const uid = created.user.id
for (const q of [
  admin.from('shops').delete().eq('owner_user_id', uid),
  admin.from('shops').update({ owner_user_id: uid }).eq('id', shopId),
]) {
  const { error } = await q
  if (error) throw error
}
const db = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY)
const { error: inErr } = await db.auth.signInWithPassword({ email, password })
if (inErr) throw inErr

const tools = dbTools(db, '2026-10-01')
const results: { name: string; result: Record<string, any> }[] = []
const run = async (name: string, args: Record<string, string> = {}) => {
  const result = await tools.run(name, args)
  results.push({ name, result })
  return result as Record<string, any>
}

const actions = await run('get_todays_actions')
assert(actions.actions.length >= 2, 'actions from the pipeline')
assertEquals(actions.source.model_version, 1)
for (const a of actions.actions) assert(a.details && a.value_rm > 0, `details for ${a.product}`)

const reorder = await run('get_reorder', { product: 'milo' })
assertEquals(reorder.decision, 'REORDER')
assert(reorder.details.days_of_cover < reorder.details.lead_time_days + reorder.details.review_days)

const clear = await run('get_clearance', { product: 'cuka' })
assertEquals(clear.decision, 'CLEAR')
assert(clear.details.break_even_discount_pct > clear.details.discount_pct)

const slow = await run('get_true_cost', { product: 'slow_stock' })
assert(slow.products >= 1 && slow.total_annual_cost > 0)

const fc = await run('get_forecast', { product: 'gula' })
assert(fc.weeks >= 3 && fc.forecast[0].likely > 0)

const st = await run('get_data_status')
assertEquals(st.model.version, 1)

// Templated answers built from these real rows pass the guardrail.
for (const r of results) {
  const text = renderFromResults([r], 'en')
  if (text) assert(checkNumbers(text, [r.result], '').ok, `template for ${r.name}: ${text}`)
}
console.log(renderFromResults([results[0]], 'ms'))
console.log('AGENT ON PIPELINE PASS')
