// Settings screen: the shop's True Cost settings and per-product supplier details, as the nightly run reads them.
// Plain module with the client passed in, so tests can run it too. Limits mirror the table check constraints.

/** Shop fields in form order. kind: text | lang | bool | money | pct | share (stored 0-1, typed as %) | int */
export const SHOP_FIELDS = [
  { key: 'name', group: 'shop', kind: 'text', label: 'Shop name' },
  { key: 'language', group: 'shop', kind: 'lang', label: 'Assistant language when unclear',
    help: 'RetailIQ answers in the language you ask in; this is the fallback.' },
  { key: 'agent_log_consent', group: 'shop', kind: 'bool', label: 'Save my questions and answers to improve RetailIQ',
    help: 'Off by default. Questions are sent to Google Gemini to write the answer either way.' },

  { key: 'loan_outstanding', group: 'money', kind: 'money', label: 'Loan or financing outstanding (RM)',
    help: 'The part of your stock bought with borrowed money is charged the loan rate; the rest the opportunity rate.' },
  { key: 'loan_rate_pct', group: 'money', kind: 'pct', label: 'Loan interest rate (% a year)' },
  { key: 'rent_per_month', group: 'money', kind: 'money', label: 'Rent per month (RM)' },
  { key: 'utilities_per_month', group: 'money', kind: 'money', label: 'Utilities per month (RM)' },
  { key: 'storage_share_of_rent', group: 'money', kind: 'share', label: 'Share of rent and utilities used for stock (%)' },

  { key: 'opportunity_rate_pct', group: 'advanced', kind: 'pct', label: 'Opportunity rate (% a year)',
    help: 'What your own cash would earn elsewhere in the business.' },
  { key: 'service_rate_pct', group: 'advanced', kind: 'pct', label: 'Handling cost (% of stock value a year)' },
  { key: 'risk_rate_pct', group: 'advanced', kind: 'pct', label: 'Spoilage and damage (% of stock value a year)' },
  { key: 'holding_days', group: 'advanced', kind: 'int', min: 1, max: 365, label: 'Selling window for slow stock (days)',
    help: 'How long until the next season when slow stock could sell at full price.' },
  { key: 'review_days', group: 'advanced', kind: 'int', min: 1, max: 60, label: 'Days between orders' },
]

/** Per-product fields. Blank holding days uses the shop's selling window. */
export const PRODUCT_FIELDS = [
  { key: 'lead_time_days', kind: 'int', min: 0, max: 365, label: 'Lead time (days)', required: true },
  { key: 'pack_size', kind: 'int', min: 1, max: 100000, label: 'Units per pack', required: true },
  { key: 'holding_days', kind: 'int', min: 1, max: 365, label: 'Selling window (days)', required: false, blank: 'shop default' },
  { key: 'shelf_space', kind: 'num', min: 0, max: 100000, label: 'Shelf space per unit', required: false, blank: '1' },
]

const SHOP_COLS = ['id', ...SHOP_FIELDS.map((f) => f.key)].join(', ')
const PRODUCT_COLS = ['id', 'name', 'sku', ...PRODUCT_FIELDS.map((f) => f.key)].join(', ')

const blank = (v) => v === null || v === undefined || String(v).trim() === ''

/** Stored value -> what the input shows. */
export function toInput(field, v) {
  if (field.kind === 'bool') return v === true
  if (blank(v)) return ''
  if (field.kind === 'share') return String(Number((Number(v) * 100).toFixed(2)))
  return String(v)
}

/** Input -> stored value, or { error }. Money keeps at most 2 decimals; nothing is rounded silently. */
export function fromInput(field, raw, required = true) {
  if (field.kind === 'bool') return { value: raw === true }
  if (field.kind === 'lang') return raw === 'ms' || raw === 'en' ? { value: raw } : { error: 'Choose Malay or English.' }
  const s = String(raw ?? '').trim()
  if (field.kind === 'text') return s ? { value: s.slice(0, 80) } : { error: 'Enter a name.' }
  if (!s) return required ? { error: 'Enter a number.' } : { value: null }
  const t = s.replace(/^RM\s*/i, '').replace(/,/g, '').replace(/%$/, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: 'Enter a number (no minus sign).' }
  const n = Number(t)
  switch (field.kind) {
    case 'money':
      if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Use at most 2 decimals (sen).' }
      return n > 10_000_000 ? { error: 'That looks too large.' } : { value: n }
    case 'pct':
      return n > 100 ? { error: 'Between 0 and 100.' } : { value: n }
    case 'share':
      return n > 100 ? { error: 'Between 0 and 100.' } : { value: Number((n / 100).toFixed(4)) }
    case 'int':
      if (!Number.isInteger(n)) return { error: 'Whole days or units only.' }
      return n < field.min || n > field.max ? { error: `Between ${field.min} and ${field.max}.` } : { value: n }
    default: // num
      return n < field.min || n > field.max ? { error: `Between ${field.min} and ${field.max}.` } : { value: n }
  }
}

export function shopForm(shop) {
  return Object.fromEntries(SHOP_FIELDS.map((f) => [f.key, toInput(f, shop[f.key])]))
}

export function productForm(products) {
  return Object.fromEntries(products.map((p) => [p.id, Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.key, toInput(f, p[f.key])]))]))
}

/**
 * Compare the form with what is stored. Returns { shopPatch, productPatches: [{ id, patch }], errors }
 * where errors maps 'shop.<key>' or '<productId>.<key>' to a message. Only changed values are patched.
 */
export function diffSettings(shop, form, products, pform) {
  const errors = {}
  const shopPatch = {}
  for (const f of SHOP_FIELDS) {
    const r = fromInput(f, form[f.key])
    if (r.error) errors[`shop.${f.key}`] = r.error
    else if (!same(r.value, shop[f.key])) shopPatch[f.key] = r.value
  }
  const productPatches = []
  for (const p of products) {
    const patch = {}
    for (const f of PRODUCT_FIELDS) {
      const r = fromInput(f, pform[p.id]?.[f.key], f.required)
      if (r.error) errors[`${p.id}.${f.key}`] = r.error
      else if (!same(r.value, p[f.key])) patch[f.key] = r.value
    }
    if (Object.keys(patch).length) productPatches.push({ id: p.id, patch })
  }
  return { shopPatch, productPatches, errors }
}

function same(a, b) {
  if (blank(a) && blank(b)) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return a === b
}

export async function loadSettings(supabase) {
  const [shop, products] = await Promise.all([
    supabase.from('shops').select(SHOP_COLS).maybeSingle(),
    supabase.from('products').select(PRODUCT_COLS).order('name'),
  ])
  if (shop.error) throw shop.error
  if (products.error) throw products.error
  return { shop: shop.data, products: products.data ?? [] }
}

/** Save the changed values (RLS: own shop and products only). Throws the first database error. */
export async function saveSettings(supabase, shopId, shopPatch, productPatches) {
  const writes = []
  if (Object.keys(shopPatch).length) writes.push(supabase.from('shops').update(shopPatch).eq('id', shopId))
  for (const { id, patch } of productPatches) writes.push(supabase.from('products').update(patch).eq('id', id))
  for (const r of await Promise.all(writes)) if (r.error) throw r.error
}

/** Ask for a forecast run now (trigger-ml). Resolves to { job_id, status } or throws with a message. */
export async function recalculate(supabase) {
  const { data, error } = await supabase.functions.invoke('trigger-ml', { body: { mode: 'predict' } })
  if (error) {
    let msg = ''
    try {
      msg = (await error.context?.clone?.().json?.())?.error ?? ''
    } catch {
      // not JSON
    }
    throw new Error(msg || 'The forecast run could not be started. Your settings are saved and apply tonight.')
  }
  return data
}
