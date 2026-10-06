// Agent tools: declarations for Gemini, call validation, and the database implementations.
// Every query runs with the caller's JWT, so RLS limits it to their shop.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ToolDeclaration } from '../_shared/llm.ts'

const productParam = {
  type: 'object',
  properties: {
    product: { type: 'string', description: 'Product name as the owner wrote it (Malay or English), or its SKU.' },
  },
  required: ['product'],
}

export const TOOLS: ToolDeclaration[] = [
  {
    name: 'get_todays_actions',
    description:
      "The shop's top 3 recommended actions now (reorder, clear or hold), largest ringgit value first. " +
      "Use for 'what should I do today/this week', 'what to order this week', 'apa nak buat', 'apa nak order minggu ni'.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_forecast',
    description: 'Demand forecast for one product, next 4 weeks: likely (P50), low (P10) and high (P90) units per week.',
    parametersJsonSchema: productParam,
  },
  {
    name: 'get_true_cost',
    description:
      'True Cost of Stock: what holding stock costs per day and per year (financing, space, service, risk, ' +
      'opportunity). Pass one product name, or "slow_stock" for all slow-moving stock together.',
    parametersJsonSchema: {
      type: 'object',
      properties: { product: { type: 'string', description: 'A product name, or "slow_stock".' } },
      required: ['product'],
    },
  },
  {
    name: 'get_reorder',
    description: 'Reorder recommendation for one product: whether to order, how many units, cash needed, days of stock left, lead time.',
    parametersJsonSchema: productParam,
  },
  {
    name: 'get_clearance',
    description: 'Hold-or-clear recommendation for one product: whether to discount, by how much, break-even discount, cash released.',
    parametersJsonSchema: productParam,
  },
  {
    name: 'find_product',
    description: 'List products whose names match what the owner typed. Use when it is unclear which product they mean.',
    parametersJsonSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Product name or part of it.' } },
      required: ['name'],
    },
  },
  {
    name: 'get_data_status',
    description:
      'How current and reliable the numbers are: forecast model version and accuracy (WAPE), last update, ' +
      'low-confidence products, last data upload.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
const MAX_ARG_LENGTH = 100

export type Validated = { ok: true; name: string; args: Record<string, string> } | { ok: false; error: string }

/** Check a function call from Gemini against the declarations. Unknown or malformed calls are rejected. */
export function validateCall(call: { name?: string; args?: unknown }): Validated {
  const tool = call.name ? BY_NAME.get(call.name) : undefined
  if (!tool) return { ok: false, error: `unknown tool: ${call.name ?? '(none)'}` }
  const schema = tool.parametersJsonSchema as { properties: Record<string, unknown>; required?: string[] }
  const args = (call.args ?? {}) as Record<string, unknown>
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'arguments must be an object' }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(args)) {
    if (!(k in schema.properties)) return { ok: false, error: `unknown argument: ${k}` }
    if (typeof v !== 'string') return { ok: false, error: `argument ${k} must be text` }
    const s = v.trim()
    if (!s || s.length > MAX_ARG_LENGTH) return { ok: false, error: `argument ${k} is empty or too long` }
    out[k] = s
  }
  for (const k of schema.required ?? []) {
    if (!(k in out)) return { ok: false, error: `missing argument: ${k}` }
  }
  return { ok: true, name: tool.name, args: out }
}

export interface ToolRunner {
  run(name: string, args: Record<string, string>): Promise<Record<string, unknown>>
}

// ---- database implementations ---------------------------------------------------------------

type Decision = {
  id: string
  type: 'REORDER' | 'CLEAR' | 'HOLD'
  product_id: string
  qty: number | null
  value_rm: number | null
  reason_json: Record<string, any>
  created_at: string
  model_version_id: string | null
}

const DECISION_COLS = 'id, type, product_id, qty, value_rm, reason_json, created_at, model_version_id'
const r2 = (n: number) => Math.round(n * 100) / 100

export function dbTools(db: SupabaseClient, today: string): ToolRunner {
  const sources = new Map<string, Record<string, unknown>>()

  async function source(modelVersionId: string | null, runAt?: string) {
    let mv: Record<string, unknown> = {}
    if (modelVersionId) {
      if (!sources.has(modelVersionId)) {
        const { data } = await db
          .from('model_versions')
          .select('version, model_type, created_at, metrics_json')
          .eq('id', modelVersionId)
          .maybeSingle()
        sources.set(modelVersionId, data
          ? { model_version: data.version, model_type: data.model_type,
              trained_through: data.metrics_json?.trained_through ?? null }
          : {})
      }
      mv = sources.get(modelVersionId)!
    }
    return { ...mv, run_date: runAt ? runAt.slice(0, 10) : null }
  }

  async function names(ids: string[]) {
    if (!ids.length) return new Map<string, string>()
    const { data, error } = await db.from('products').select('id, name').in('id', ids)
    if (error) throw error
    return new Map((data ?? []).map((p) => [p.id as string, p.name as string]))
  }

  async function resolve(q: string): Promise<{ id: string; name: string } | Record<string, unknown>> {
    const { data, error } = await db.rpc('find_products', { q, max_results: 5 })
    if (error) throw error
    const rows = (data ?? []) as { id: string; name: string; score: number; exact: boolean }[]
    if (rows[0]?.exact) return { id: rows[0].id, name: rows[0].name }
    if (!rows.length || rows[0].score < 0.3) {
      return { error: 'product_not_found', query: q, suggestions: rows.filter((r) => r.score >= 0.15).map((r) => r.name) }
    }
    if (rows.length > 1 && rows[0].score - rows[1].score < 0.05) {
      return { error: 'ambiguous_product', query: q, candidates: rows.slice(0, 3).map((r) => r.name) }
    }
    return { id: rows[0].id, name: rows[0].name }
  }

  async function current(productId: string, types: string[]): Promise<Decision | null> {
    const { data, error } = await db
      .from('decisions')
      .select(DECISION_COLS)
      .eq('product_id', productId)
      .in('type', types)
      .is('superseded_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return (data?.[0] as Decision) ?? null
  }

  const isProduct = (p: unknown): p is { id: string; name: string } => typeof (p as { id?: unknown }).id === 'string'

  const impl: Record<string, (a: Record<string, string>) => Promise<Record<string, unknown>>> = {
    async get_todays_actions() {
      const { data, error } = await db
        .from('decisions')
        .select(DECISION_COLS)
        .is('superseded_at', null)
        .in('type', ['REORDER', 'CLEAR'])
        .order('value_rm', { ascending: false, nullsFirst: false })
        .limit(3)
      if (error) throw error
      const rows = (data ?? []) as Decision[]
      if (!rows.length) return { actions: [], note: 'no_decisions_yet' }
      const n = await names(rows.map((r) => r.product_id))
      return {
        actions: rows.map((r) => ({
          type: r.type,
          product: n.get(r.product_id),
          qty: r.qty,
          value_rm: r.value_rm,
          details: r.type === 'REORDER' ? r.reason_json.reorder : r.reason_json.hold_or_clear,
        })),
        source: await source(rows[0].model_version_id, rows[0].created_at),
      }
    },

    async get_forecast({ product }) {
      const p = await resolve(product)
      if (!isProduct(p)) return p
      const from = new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await db
        .from('forecasts')
        .select('week_start, p10, p50, p90, low_confidence, model_version_id, created_at')
        .eq('product_id', p.id)
        .gte('week_start', from)
        .order('week_start')
        .limit(4)
      if (error) throw error
      if (!data?.length) return { product: p.name, error: 'no_forecast_yet' }
      return {
        product: p.name,
        weeks: data.length,
        forecast: data.map(({ week_start, p10, p50, p90 }) => ({ week_start, low: p10, likely: p50, high: p90 })),
        low_confidence: data.some((d) => d.low_confidence),
        source: await source(data[0].model_version_id, data[0].created_at),
      }
    },

    async get_true_cost({ product }) {
      if (product.toLowerCase().replace(/[\s-]/g, '_') === 'slow_stock') {
        const { data, error } = await db
          .from('decisions')
          .select(DECISION_COLS)
          .is('superseded_at', null)
          .in('type', ['CLEAR', 'HOLD'])
        if (error) throw error
        const rows = (data ?? []) as Decision[]
        if (!rows.length) return { slow_stock: [], note: 'no_slow_stock' }
        const n = await names(rows.map((r) => r.product_id))
        const items = rows.map((r) => ({
          product: n.get(r.product_id),
          stock_value: r.reason_json.true_cost?.stock_value ?? 0,
          cost_per_day: r.reason_json.true_cost?.cost_per_day ?? 0,
          annual_cost: r.reason_json.true_cost?.annual_cost ?? 0,
        })).sort((a, b) => b.annual_cost - a.annual_cost)
        return {
          slow_stock: items,
          products: items.length,
          total_stock_value: r2(items.reduce((s, i) => s + i.stock_value, 0)),
          total_cost_per_day: r2(items.reduce((s, i) => s + i.cost_per_day, 0)),
          total_annual_cost: r2(items.reduce((s, i) => s + i.annual_cost, 0)),
          source: await source(rows[0].model_version_id, rows[0].created_at),
        }
      }
      const p = await resolve(product)
      if (!isProduct(p)) return p
      const d = await current(p.id, ['REORDER', 'CLEAR', 'HOLD'])
      if (!d?.reason_json.true_cost) return { product: p.name, error: 'no_cost_data_yet' }
      return { product: p.name, true_cost: d.reason_json.true_cost, source: await source(d.model_version_id, d.created_at) }
    },

    async get_reorder({ product }) {
      const p = await resolve(product)
      if (!isProduct(p)) return p
      const d = await current(p.id, ['REORDER'])
      if (!d) return { product: p.name, decision: 'NO_REORDER_NEEDED' }
      return {
        product: p.name,
        decision: 'REORDER',
        qty: d.qty,
        cash_required: d.value_rm,
        details: d.reason_json.reorder,
        source: await source(d.model_version_id, d.created_at),
      }
    },

    async get_clearance({ product }) {
      const p = await resolve(product)
      if (!isProduct(p)) return p
      const d = await current(p.id, ['CLEAR', 'HOLD'])
      if (!d) return { product: p.name, decision: 'NOT_SLOW_STOCK' }
      return {
        product: p.name,
        decision: d.type,
        details: d.reason_json.hold_or_clear,
        source: await source(d.model_version_id, d.created_at),
      }
    },

    async find_product({ name }) {
      const { data, error } = await db.rpc('find_products', { q: name, max_results: 5 })
      if (error) throw error
      return { matches: ((data ?? []) as { name: string; sku: string | null; score: number }[])
        .filter((r) => r.score >= 0.15).map((r) => ({ name: r.name, sku: r.sku })) }
    },

    async get_data_status() {
      const [champion, job, upload, low] = await Promise.all([
        db.from('model_versions').select('version, model_type, wape, baseline_wape, created_at, metrics_json')
          .eq('status', 'champion').maybeSingle(),
        db.from('ml_jobs').select('type, status, finished_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('uploads').select('kind, processed_at, rows_ok, rows_rejected, health_json').eq('status', 'done')
          .order('processed_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('forecasts').select('product_id').eq('low_confidence', true).gte('week_start', today).limit(200),
      ])
      const lowIds = [...new Set((low.data ?? []).map((r) => r.product_id as string))]
      const n = await names(lowIds.slice(0, 10))
      const c = champion.data
      return {
        model: c
          ? { version: c.version, type: c.model_type, wape_pct: c.wape == null ? null : r2(c.wape * 100),
              baseline_wape_pct: c.baseline_wape == null ? null : r2(c.baseline_wape * 100),
              trained_through: c.metrics_json?.trained_through ?? null, created: c.created_at?.slice(0, 10) }
          : null,
        last_job: job.data ?? null,
        last_upload: upload.data
          ? { kind: upload.data.kind, date: upload.data.processed_at?.slice(0, 10), rows_ok: upload.data.rows_ok,
              rows_rejected: upload.data.rows_rejected, days_of_history: upload.data.health_json?.days_of_history ?? null }
          : null,
        low_confidence_products: lowIds.length,
        low_confidence_examples: [...n.values()],
      }
    },
  }

  return {
    async run(name, args) {
      const f = impl[name]
      if (!f) return { error: `unknown tool: ${name}` }
      return await f(args)
    },
  }
}
