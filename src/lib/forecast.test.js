// deno test src/lib  (pure mapping; no network)
import { assertEquals } from 'jsr:@std/assert@1'
import { chartRows, historyStart, panel } from './forecast.js'

Deno.test('history window is the 120 days ending on the run date', () => {
  assertEquals(historyStart('2026-09-30'), '2026-06-03') // Jun 3 .. Sep 30 inclusive = 28 + 31 + 31 + 30 = 120
  assertEquals(historyStart('2026-03-01'), '2025-11-02') // across a year end, Feb has 28 days
})

Deno.test('chart rows: sales as units, forecast with its p10-p90 band; strings from numeric columns become numbers', () => {
  assertEquals(
    chartRows(
      [{ date: '2026-09-29', qty: '16.000' }, { date: '2026-09-30', qty: 4 }],
      [{ date: '2026-10-01', p10: 7.251, p50: '9.115', p90: 11.2 }],
    ),
    [
      { date: '2026-09-29', units: 16 },
      { date: '2026-09-30', units: 4 },
      { date: '2026-10-01', p10: 7.251, p50: 9.115, p90: 11.2, band: [7.251, 11.2] },
    ],
  )
})

const metrics = {
  as_of: '2026-09-30', model_version_id: 'mv1', days_of_cover: 1.1, forecast_p10: 217.6, forecast_p50: 255.2,
  forecast_p90: 296.9, confidence: 'High', low_confidence: false,
}
const product = { id: 'p1', sku: null, name: 'milo', lead_time_days: 5 }
const model = { version: 1, model_type: 'adida' }

Deno.test('panel for a product with a REORDER decision shows its stored qty and cash', () => {
  const reorder = { qty: 118, reason_json: { reorder: { qty: 118, cash_required: 1858.5 } } }
  assertEquals(panel({ product, metrics, reorder, model }), {
    p50: 255.2, p90: 296.9, daysOfCover: 1.1, leadTimeDays: 5, orderQty: 118, cashRequired: 1858.5,
    confidence: 'High', lowConfidence: false, source: 'model v1 (adida), 2026-09-30',
  })
})

Deno.test('forecast but no REORDER means no order needed; no metrics means every value is missing, not 0', () => {
  const none = panel({ product, metrics: { ...metrics, days_of_cover: null }, reorder: null, model })
  assertEquals([none.orderQty, none.cashRequired, none.daysOfCover], [0, null, null])
  const empty = panel({ product, metrics: null, reorder: null, model: null })
  assertEquals(empty, {
    p50: null, p90: null, daysOfCover: null, leadTimeDays: 5, orderQty: null, cashRequired: null,
    confidence: null, lowConfidence: false, source: '',
  })
})
