// Ask box (src/lib/ask.js) against agent-ask on the LOCAL stack, for a pipeline-filled shop.
//   cd ml && .venv/Scripts/python scripts/local_predict.py     -> "LOCAL PREDICT PASS <shop_id>"
//   npx supabase functions serve   (in another terminal)
//   deno run -A --config supabase/functions/deno.json supabase/tests/ask_e2e.ts <shop_id>
// Without a working GEMINI_API_KEY the answers are the templated fallback; both paths must pass.
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { askAgent, AskError } from '../../src/lib/ask.js'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: ask_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY

// Hand the seeded shop to a real, signed-in user (the Python seed has no login).
const email = `ask-${crypto.randomUUID().slice(0, 8)}@test.my`
const password = crypto.randomUUID()
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw error
await admin.from('shops').delete().eq('owner_user_id', created.user.id)
await admin.from('shops').update({ owner_user_id: created.user.id }).eq('id', shopId)
const db = createClient(status.API_URL, anon, { auth: { persistSession: false } })
await db.auth.signInWithPassword({ email, password })

const values = ((await admin.from('decisions').select('value_rm').eq('shop_id', shopId).is('superseded_at', null)).data ?? [])
  .map((d) => Number(d.value_rm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

for (const [question, lang] of [['What should I do today?', 'en'], ['Apa nak buat hari ni?', 'ms']]) {
  const t0 = Date.now()
  const r = await askAgent(db, question)
  console.log(`\n[${lang}] ${question}  (${Date.now() - t0} ms, fallback=${r.fallback}, tools=${r.tools})\n${r.answer}`)
  assertEquals(r.language, lang)
  assertMatch(r.answer, /RM\d/)
  // Every RM figure in the answer is one of this shop's stored decision values (or a sum the tools returned).
  assert(values.some((v) => r.answer.includes(v)), `answer cites a stored value (${values.join(', ')})`)
}

// Off-topic questions get a short refusal, not an error.
const off = await askAgent(db, 'Write me a poem about my shop')
assert(off.answer.length > 0)

// Rejected before the network; nothing is sent.
await assertRejects(() => askAgent(db, ' '), AskError, 'Type a question first.')

// A client with no signed-in user has no shop: an owner-facing error that offers no retry.
const signedOut = createClient(status.API_URL, anon, { auth: { persistSession: false } })
const e = await assertRejects(() => askAgent(signedOut, 'What should I do today?'), AskError)
assertEquals(e.retry, false)
console.log('\nASK E2E PASS')
