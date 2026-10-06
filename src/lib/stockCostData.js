// Stock Cost screen queries. Plain module with the client passed in, so tests can run it too.
import { costDetail, costRows, holdOrClear } from './stockCost.js'

const METRIC_COLS =
  'product_id, as_of, on_hand, stock_value, age_days, days_of_cover, cost_components, annual_cost, carrying_rate, ' +
  'cost_per_day, cost_30d, cost_180d, slow_stock'

/** Every product with stored cost figures for the signed-in shop, highest cost per day first, plus details by id. */
export async function loadStockCost(supabase) {
  const metrics = await supabase.from('product_metrics').select(METRIC_COLS)
    .order('cost_per_day', { ascending: false }).order('product_id')
  if (metrics.error) throw metrics.error
  const ms = metrics.data ?? []
  if (!ms.length) return { asOf: null, rows: [], details: {} }

  const ids = ms.map((m) => m.product_id)
  const [products, decisions] = await Promise.all([
    supabase.from('products').select('id, sku, name').in('id', ids),
    supabase.from('decisions').select('product_id, type, reason_json')
      .is('superseded_at', null).in('type', ['CLEAR', 'HOLD']).in('product_id', ids),
  ])
  for (const r of [products, decisions]) if (r.error) throw r.error

  const rows = costRows(ms, products.data ?? [])
  const byProduct = new Map((decisions.data ?? []).map((d) => [d.product_id, d]))
  const details = Object.fromEntries(ms.map((m, i) => [m.product_id, {
    ...costDetail(m),
    hold: holdOrClear(byProduct.get(m.product_id), rows[i].name),
  }]))
  return { asOf: ms[0].as_of, rows, details }
}
