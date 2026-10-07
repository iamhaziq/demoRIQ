// Today screen queries (src/lib/todayData.js) against a pipeline-filled shop on the LOCAL stack.
//   cd ml && .venv/Scripts/python scripts/local_predict.py     -> "LOCAL PREDICT PASS <shop_id>"
//   deno run -A --config supabase/functions/deno.json supabase/tests/today_e2e.ts <shop_id>
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { loadToday, saveFeedback } from '../../src/lib/todayData.js'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: today_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)

// Hand the seeded shop to a real, signed-in user (the Python seed has no login).
const email = `today-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw error
await admin.from('shops').delete().eq('owner_user_id', created.user.id)
await admin.from('shops').update({ owner_user_id: created.user.id }).eq('id', shopId)
const db = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
await db.auth.signInWithPassword({ email, password })

const t = await loadToday(db)
assert(t.kpis && t.kpis.stock_value > 0, 'KPI tiles from shop_kpis')
assert(t.cards.length >= 2, 'cards from current decisions')
assert(t.cards.every((c) => c.title && c.impact.value.startsWith('RM') && c.sources[1]?.startsWith('model v')))
assertEquals(t.status, {})
console.log('tiles:', t.kpis, '\ncards:', t.cards.map((c) => `${c.type} ${c.title} ${c.impact.value}`))

// Approve, then undo, then mark wrong: the latest action is the state after a reload.
const id = t.cards[0].id
for (const action of ['done', 'undo', 'wrong']) assertEquals(await saveFeedback(db, shopId, id, action), null)
assertEquals((await loadToday(db)).status, { [id]: 'wrong' })

// Feedback for another shop's decision is refused.
const other = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
const e2 = `other-${crypto.randomUUID().slice(0, 8)}@test.my`
await admin.auth.admin.createUser({ email: e2, password, email_confirm: true })
await other.auth.signInWithPassword({ email: e2, password })
assert(await saveFeedback(other, shopId, id, 'done'), 'cross-shop feedback rejected')
assertEquals((await loadToday(other)).cards, [])
console.log('TODAY E2E PASS')
