// deno test src/lib  (pure parsing + fake client; no network)
import { assertEquals } from 'jsr:@std/assert@1'
import { diffSettings, fromInput, productForm, PRODUCT_FIELDS, saveSettings, SHOP_FIELDS, shopForm, toInput } from './settings.js'

const F = Object.fromEntries([...SHOP_FIELDS, ...PRODUCT_FIELDS].map((f) => [f.key, f]))

Deno.test('money: RM prefix and commas accepted, at most 2 decimals, never negative', () => {
  assertEquals(fromInput(F.rent_per_month, 'RM 1,200.50'), { value: 1200.5 })
  assertEquals(fromInput(F.rent_per_month, '1200.505').error, 'Use at most 2 decimals (sen).')
  assertEquals(fromInput(F.rent_per_month, '-5').error, 'Enter a number (no minus sign).')
  assertEquals(fromInput(F.rent_per_month, '').error, 'Enter a number.')
})

Deno.test('share of rent is typed as % and stored as a fraction (15% <-> 0.15)', () => {
  assertEquals(fromInput(F.storage_share_of_rent, '15'), { value: 0.15 })
  assertEquals(fromInput(F.storage_share_of_rent, '12.5%'), { value: 0.125 })
  assertEquals(toInput(F.storage_share_of_rent, 0.15), '15')
  assertEquals(fromInput(F.storage_share_of_rent, '150').error, 'Between 0 and 100.')
})

Deno.test('days follow the table limits; product selling window may be blank (shop default)', () => {
  assertEquals(fromInput(F.review_days, '61').error, 'Between 1 and 60.')
  assertEquals(fromInput(F.lead_time_days, '0'), { value: 0 })
  assertEquals(fromInput(F.lead_time_days, '2.5').error, 'Whole days or units only.')
  assertEquals(fromInput(F.holding_days, '', false), { value: null })
  assertEquals(fromInput(F.pack_size, '', true).error, 'Enter a number.')
})

const shop = {
  id: 's1', name: 'Kedai Ali', language: 'ms', agent_log_consent: false, loan_outstanding: 20000, loan_rate_pct: 8,
  rent_per_month: 1500, utilities_per_month: 300, storage_share_of_rent: 0.15, opportunity_rate_pct: 15,
  service_rate_pct: 3, risk_rate_pct: 12, holding_days: 60, review_days: 7,
}
const products = [{ id: 'p1', name: 'Milo 1kg', lead_time_days: 7, pack_size: 12, holding_days: null, shelf_space: null }]

Deno.test('an untouched form has nothing to save; only changed values are patched', () => {
  const form = shopForm(shop)
  const pform = productForm(products)
  assertEquals(diffSettings(shop, form, products, pform), { shopPatch: {}, productPatches: [], errors: {} })

  const d = diffSettings(shop, { ...form, rent_per_month: '1,800', storage_share_of_rent: '20', agent_log_consent: true },
    products, { p1: { ...pform.p1, lead_time_days: '5', holding_days: '180' } })
  assertEquals(d.shopPatch, { rent_per_month: 1800, storage_share_of_rent: 0.2, agent_log_consent: true })
  assertEquals(d.productPatches, [{ id: 'p1', patch: { lead_time_days: 5, holding_days: 180 } }])
  assertEquals(d.errors, {})
})

Deno.test('errors are keyed by field so the form can mark them', () => {
  const d = diffSettings(shop, { ...shopForm(shop), name: '  ', loan_rate_pct: '120' }, products,
    { p1: { ...productForm(products).p1, pack_size: '0' } })
  assertEquals(d.errors, { 'shop.name': 'Enter a name.', 'shop.loan_rate_pct': 'Between 0 and 100.', 'p1.pack_size': 'Between 1 and 100000.' })
})

Deno.test('save writes the shop row and each changed product by id', async () => {
  const calls = []
  const sb = { from: (t) => ({ update: (patch) => ({ eq: (c, v) => (calls.push([t, patch, c, v]), Promise.resolve({ error: null })) }) }) }
  await saveSettings(sb, 's1', { rent_per_month: 1800 }, [{ id: 'p1', patch: { lead_time_days: 5 } }])
  assertEquals(calls, [['shops', { rent_per_month: 1800 }, 'id', 's1'], ['products', { lead_time_days: 5 }, 'id', 'p1']])
  calls.length = 0
  await saveSettings(sb, 's1', {}, [])
  assertEquals(calls, [])
})
