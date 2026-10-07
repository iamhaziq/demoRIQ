// Forecast screen rows (sales, forecast_daily, product_metrics, REORDER decision) -> what the chart and panel show.
// Mapping only: every number comes from a stored row; nothing is calculated here.
import { sourceLabel } from './cards.js'

const n = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

/** First day shown on the chart: 120 days of history ending on `asOf` (YYYY-MM-DD). */
export function historyStart(asOf) {
  const d = new Date(`${asOf}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 119)
  return d.toISOString().slice(0, 10)
}

/** Chart rows: actual units per day, then the daily forecast with its p10-p90 band. Days with no sales row are left out. */
export function chartRows(sales, daily) {
  return [
    ...sales.map((s) => ({ date: s.date, units: n(s.qty) })),
    ...daily.map((f) => ({ date: f.date, p10: n(f.p10), p50: n(f.p50), p90: n(f.p90), band: [n(f.p10), n(f.p90)] })),
  ]
}

/** Side panel values; null where nothing is stored (shown as '–'). orderQty 0 means no reorder is needed. */
export function panel({ product, metrics, reorder, model }) {
  return {
    p50: n(metrics?.forecast_p50),
    p90: n(metrics?.forecast_p90),
    daysOfCover: n(metrics?.days_of_cover),
    leadTimeDays: n(product?.lead_time_days),
    orderQty: reorder ? n(reorder.qty) : metrics ? 0 : null,
    cashRequired: reorder ? n(reorder.reason_json?.reorder?.cash_required) : null,
    confidence: metrics?.confidence ?? null,
    lowConfidence: metrics?.low_confidence === true,
    source: metrics ? sourceLabel(model, metrics.as_of) : '',
  }
}
