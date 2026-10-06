// Stock Cost screen rows (product_metrics + current CLEAR/HOLD decision) -> what the table and detail show.
// Mapping only: every number comes from a stored row; nothing is calculated here.
import { promoDraft } from './cards.js'

const n = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

/** Table rows, one per product with metrics, in the order the query returned (highest cost per day first). */
export function costRows(metrics, products) {
  const byId = new Map(products.map((p) => [p.id, p]))
  return metrics.map((m) => ({
    id: m.product_id,
    name: byId.get(m.product_id)?.name ?? '–',
    sku: byId.get(m.product_id)?.sku ?? null,
    onHand: n(m.on_hand),
    stockValue: n(m.stock_value),
    ageDays: n(m.age_days),
    daysOfCover: n(m.days_of_cover),
    costPerDay: n(m.cost_per_day),
    cost30d: n(m.cost_30d),
    slow: m.slow_stock === true,
  }))
}

/** Cost breakdown for one product. The 365-day cost is the stored annual cost. */
export function costDetail(m) {
  const c = m.cost_components ?? {}
  return {
    annualCost: n(m.annual_cost),
    carryingRate: n(m.carrying_rate),
    components: {
      financing: n(c.financing), space: n(c.space), service: n(c.service), risk: n(c.risk), opportunity: n(c.opportunity),
    },
    horizon: { day: n(m.cost_per_day), d30: n(m.cost_30d), d180: n(m.cost_180d), d365: n(m.annual_cost) },
  }
}

/**
 * Hold-or-clear slider from a CLEAR/HOLD decision: the stored sell-through rows (50-95%), where the
 * slider starts (the sell-through the run assumed), and the figures that do not depend on sell-through.
 */
export function holdOrClear(decision, name) {
  const h = decision?.reason_json?.hold_or_clear
  if (!h || !Array.isArray(h.by_sell_through) || !h.by_sell_through.length) return null
  const rows = h.by_sell_through.map((r) => ({
    sellThrough: n(r.sell_through),
    breakEvenPct: n(r.break_even_discount_pct),
    clearAtAnyDiscount: r.clear_at_any_discount === true,
    discountPct: n(r.discount_pct),
    cashReleased: n(r.cash_released),
    interestAvoided: n(r.interest_avoided_per_year),
    draft: n(r.discount_pct) === null ? null : promoDraft(name, r.discount_pct, h.units),
  }))
  const start = rows.findIndex((r) => r.sellThrough === n(h.clearance_sell_through_assumed))
  return {
    decision: h.decision ?? decision.type,
    units: n(h.units),
    holdingDays: n(h.holding_days),
    holdingCostPerUnit: n(h.holding_cost_per_unit),
    holdingCostTotal: n(h.holding_cost_total),
    loanRate: n(h.loan_rate),
    rows,
    start: start >= 0 ? start : rows.length - 1,
  }
}
