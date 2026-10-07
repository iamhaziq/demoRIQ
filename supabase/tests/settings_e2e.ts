// Settings screen (src/lib/settings.js) against a pipeline-filled shop on the LOCAL stack.
//   cd ml && .venv/Scripts/python scripts/local_predict.py     -> "LOCAL PREDICT PASS <shop_id>"
//   deno run -A --config supabase/functions/deno.json supabase/tests/settings_e2e.ts <shop_id>
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { diffSettings, loadSettings, productForm, saveSettings, shopForm } from '../../src/lib/settings.js'

const shopId = Deno.args[0]
if (!shopId) throw new Error('usage: settings_e2e.ts <shop_id>')
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY)
const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY

async function signIn(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.my`
  const password = crypto.randomUUID()
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const db = createClient(status.API_URL, anon, { auth: { persistSession: false } })
  await db.auth.signInWithPassword({ email, password })
  return { db, userId: data.user.id }
}

// Hand the seeded shop to a real, signed-in user (the Python seed has no login).
const owner = await signIn('settings')
await admin.from('shops').delete().eq('owner_user_id', owner.userId)
await admin.from('shops').update({ owner_user_id: owner.userId }).eq('id', shopId)

const before = await loadSettings(owner.db)
assertEquals(before.shop.id, shopId)
assert(before.products.length > 0)
const p = before.products[0]

// Change rent, the storage share, consent, and one product's lead time and selling window, as the form would.
const form = { ...shopForm(before.shop), rent_per_month: '2,345.60', storage_share_of_rent: '20', agent_log_consent: true }
const pform = productForm(before.products)
pform[p.id] = { ...pform[p.id], lead_time_days: '9', holding_days: '120' }
const d = diffSettings(before.shop, form, before.products, pform)
assertEquals(d.errors, {})
assertEquals(d.shopPatch, { rent_per_month: 2345.6, storage_share_of_rent: 0.2, agent_log_consent: true })
await saveSettings(owner.db, shopId, d.shopPatch, d.productPatches)

const after = await loadSettings(owner.db)
assertEquals([Number(after.shop.rent_per_month), Number(after.shop.storage_share_of_rent), after.shop.agent_log_consent],
  [2345.6, 0.2, true])
const p2 = after.products.find((x) => x.id === p.id)!
assertEquals([p2.lead_time_days, p2.holding_days], [9, 120])
assertEquals(diffSettings(after.shop, shopForm(after.shop), after.products, productForm(after.products)).shopPatch, {},
  'saved values read back as an unchanged form')

// Another account cannot change this shop or its products: RLS makes the update touch no rows.
const other = await signIn('other')
await saveSettings(other.db, shopId, { rent_per_month: 1 }, [{ id: p.id, patch: { lead_time_days: 1 } }])
const still = await loadSettings(owner.db)
assertEquals([Number(still.shop.rent_per_month), still.products.find((x) => x.id === p.id)!.lead_time_days], [2345.6, 9])

// Columns outside the settings grant are refused outright.
const { error } = await owner.db.from('shops').update({ owner_user_id: other.userId }).eq('id', shopId)
assert(error, 'owner_user_id is not writable')

// Put the shop back the way the pipeline seeded it.
await saveSettings(owner.db, shopId,
  { rent_per_month: before.shop.rent_per_month, storage_share_of_rent: before.shop.storage_share_of_rent, agent_log_consent: before.shop.agent_log_consent },
  [{ id: p.id, patch: { lead_time_days: p.lead_time_days, holding_days: p.holding_days } }])
console.log('SETTINGS E2E PASS')
