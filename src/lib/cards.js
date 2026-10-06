// Decision rows (public.decisions + reason_json) -> the card shape DecisionCard renders.
// Formatting only: every number comes from the row; nothing is calculated here.
import { money, num } from '../format.js'

/** "model v3 (lightgbm), 2026-10-06" */
export function sourceLabel(model, runDate) {
  const parts = []
  if (model) parts.push(`model v${model.version} (${model.model_type})`)
  if (runDate) parts.push(runDate)
  return parts.join(', ')
}

function reorderCard(d, name, source) {
  const r = d.reason_json.reorder ?? {}
  const f = d.reason_json.forecast ?? {}
  return {
    id: d.id,
    type: 'REORDER',
    title: `Reorder soon: ${name}`,
    decision: `Order ${num(d.qty)} units this week.`,
    why:
      `About ${num(r.days_of_cover)} days of stock left and the supplier needs ${r.lead_time_days} days. ` +
      `Forecast demand for the next ${f.days ?? 28} days is ${num(f.p50)} units.`,
    evidence: [
      { label: 'Stock on hand', value: num(r.on_hand) },
      { label: 'Days of stock left', value: num(r.days_of_cover) },
      { label: `Forecast ${f.days ?? 28} days (likely)`, value: num(f.p50) },
      { label: `Forecast ${f.days ?? 28} days (high case)`, value: num(f.p90) },
    ],
    impact: { label: 'Cash required', value: money(d.value_rm) },
    confidence: d.reason_json.confidence ?? 'Low',
    sources: ['Demand forecast', source].filter(Boolean),
    draft: `Hi, please supply ${num(d.qty)} units of ${name}. We need delivery within ${r.lead_time_days} days. Thank you.`,
  }
}

function clearCard(d, name, source) {
  const h = d.reason_json.hold_or_clear ?? {}
  return {
    id: d.id,
    type: 'CLEAR',
    title: `Clear slow stock: ${name}`,
    decision: `Start a ${h.discount_pct}% clearance now. Holding until the next season costs more.`,
    why:
      `${num(h.units)} units are not expected to sell in the next ${h.holding_days} days at full price. ` +
      `Holding them that long costs ${money(h.holding_cost_total)}. Any discount below ${h.break_even_discount_pct}% beats holding.`,
    evidence: [
      { label: 'Units on shelf', value: num(h.units) },
      { label: 'Selling window', value: `${h.holding_days} days` },
      { label: 'Holding cost per unit', value: money(h.holding_cost_per_unit) },
      { label: 'Break-even discount', value: `${h.break_even_discount_pct}%` },
    ],
    impact: { label: 'Cash released', value: money(h.cash_released) },
    confidence: d.reason_json.confidence ?? 'Low',
    sources: ['True Cost of Stock', source].filter(Boolean),
    draft: `${name}: ${h.discount_pct}% off while stocks last. ${num(h.units)} units available in store.`,
  }
}

/**
 * decisions: rows with id, type, qty, value_rm, reason_json, created_at, model_version_id, product_id.
 * names: Map product_id -> name. models: Map model_version_id -> { version, model_type }.
 * Only actionable decisions (REORDER, CLEAR) become cards; HOLD rows feed the Stock Cost screen.
 */
export function toCards(decisions, names, models) {
  return decisions
    .filter((d) => d.type === 'REORDER' || d.type === 'CLEAR')
    .map((d) => {
      const name = names.get(d.product_id) ?? d.reason_json.product?.name ?? 'Product'
      const source = sourceLabel(models.get(d.model_version_id), d.created_at?.slice(0, 10))
      return d.type === 'REORDER' ? reorderCard(d, name, source) : clearCard(d, name, source)
    })
}

/** Latest feedback action per decision -> card status. 'undo' (or none) = no status. */
export function statusFromFeedback(rows) {
  const latest = new Map()
  for (const r of rows) {
    const cur = latest.get(r.decision_id)
    if (!cur || r.at > cur.at) latest.set(r.decision_id, r)
  }
  const status = {}
  const map = { done: 'approved', not_now: 'dismissed', wrong: 'wrong' }
  for (const [id, r] of latest) if (map[r.action]) status[id] = map[r.action]
  return status
}
