// Today screen queries. Plain module with the client passed in, so tests can run it too.
import { statusFromFeedback, toCards } from './cards.js'

const DECISION_COLS = 'id, type, product_id, qty, value_rm, reason_json, created_at, model_version_id'

/** KPI tiles, decision cards and feedback status for the signed-in shop (RLS scopes every query). */
export async function loadToday(supabase) {
  const [kpis, decisions] = await Promise.all([
    supabase.from('shop_kpis').select('as_of, stock_value, carrying_cost_per_month, cash_trapped, slow_products').maybeSingle(),
    supabase
      .from('decisions')
      .select(DECISION_COLS)
      .is('superseded_at', null)
      .in('type', ['REORDER', 'CLEAR'])
      .order('value_rm', { ascending: false, nullsFirst: false }),
  ])
  if (kpis.error) throw kpis.error
  if (decisions.error) throw decisions.error
  const rows = decisions.data ?? []

  const productIds = [...new Set(rows.map((d) => d.product_id))]
  const modelIds = [...new Set(rows.map((d) => d.model_version_id).filter(Boolean))]
  const [products, models, feedback] = await Promise.all([
    productIds.length ? supabase.from('products').select('id, name').in('id', productIds) : { data: [] },
    modelIds.length ? supabase.from('model_versions').select('id, version, model_type').in('id', modelIds) : { data: [] },
    rows.length
      ? supabase.from('decision_feedback').select('decision_id, action, at').in('decision_id', rows.map((d) => d.id))
      : { data: [] },
  ])
  for (const r of [products, models, feedback]) if (r.error) throw r.error

  const names = new Map(products.data.map((p) => [p.id, p.name]))
  const modelMap = new Map(models.data.map((m) => [m.id, m]))
  return { kpis: kpis.data, cards: toCards(rows, names, modelMap), status: statusFromFeedback(feedback.data) }
}

/** Append a feedback row; the latest row per decision is its state. */
export async function saveFeedback(supabase, shopId, decisionId, action) {
  const { error } = await supabase.from('decision_feedback').insert({ shop_id: shopId, decision_id: decisionId, action })
  return error
}
