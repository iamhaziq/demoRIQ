// deno test src/lib  (pure mapping; no network)
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { statusFromFeedback, toCards } from './cards.js'

const models = new Map([['mv1', { version: 3, model_type: 'lightgbm' }]])
const names = new Map([['p1', 'Milo 1kg'], ['p2', 'Kopi Tongkat 200g']])
const reorder = {
  id: 'd1', type: 'REORDER', product_id: 'p1', qty: 306, value_rm: 180.54, created_at: '2026-10-06T18:00:00Z',
  model_version_id: 'mv1',
  reason_json: {
    confidence: 'Medium',
    forecast: { days: 28, p10: 362.9, p50: 579, p90: 795.1 },
    reorder: { on_hand: 92, days_of_cover: 4.45, lead_time_days: 7, qty: 306, cash_required: 180.54 },
  },
}
const clear = {
  id: 'd2', type: 'CLEAR', product_id: 'p2', qty: 175, value_rm: 1496.88, created_at: '2026-10-06T18:00:00Z',
  model_version_id: 'mv1',
  reason_json: {
    confidence: 'Low',
    hold_or_clear: { units: 175, holding_days: 180, holding_cost_per_unit: 1.73, holding_cost_total: 302.4,
      break_even_discount_pct: 34.5, discount_pct: 10, cash_released: 1496.88 },
  },
}

Deno.test('REORDER card reproduces the deck card from stored numbers', () => {
  const [c] = toCards([reorder], names, models)
  assertEquals(c.title, 'Reorder soon: Milo 1kg')
  assertEquals(c.decision, 'Order 306 units this week.')
  assertEquals(c.why, 'About 4.5 days of stock left and the supplier needs 7 days. Forecast demand for the next 28 days is 579 units.')
  assertEquals(c.impact, { label: 'Cash required', value: 'RM180.54' })
  assertEquals(c.sources, ['Demand forecast', 'model v3 (lightgbm), 2026-10-06'])
  assertMatch(c.draft, /please supply 306 units of Milo 1kg/)
  assertEquals(c.confidence, 'Medium')
})

Deno.test('CLEAR card reproduces the deck card from stored numbers', () => {
  const [c] = toCards([clear], names, models)
  assertEquals(c.title, 'Clear slow stock: Kopi Tongkat 200g')
  assertEquals(c.decision, 'Start a 10% clearance now. Holding until the next season costs more.')
  assertMatch(c.why, /costs RM302\.40\. Any discount below 34\.5% beats holding\./)
  assertEquals(c.impact.value, 'RM1,496.88')
  assertEquals(c.draft, 'Kopi Tongkat 200g: 10% off while stocks last. 175 units available in store.')
})

Deno.test('break-even of 100% or more reads as any discount, never as a percentage above 100', () => {
  const h = { ...clear.reason_json.hold_or_clear, break_even_discount_pct: 142.5, clear_at_any_discount: true }
  const [c] = toCards([{ ...clear, reason_json: { ...clear.reason_json, hold_or_clear: h } }], names, models)
  assertMatch(c.why, /costs RM302\.40\. Any discount beats holding\.$/)
  assertEquals(c.evidence[3], { label: 'Break-even discount', value: 'Any discount' })
})

Deno.test('HOLD rows are not cards; missing numbers show as a dash, not 0', () => {
  assertEquals(toCards([{ ...clear, type: 'HOLD' }], names, models), [])
  const noDays = { ...reorder, reason_json: { ...reorder.reason_json, reorder: { lead_time_days: 7 } } }
  assertMatch(toCards([noDays], names, models)[0].why, /^About – days/)
})

Deno.test('latest feedback wins; undo clears the status', () => {
  assertEquals(statusFromFeedback([
    { decision_id: 'd1', action: 'done', at: '2026-10-07T01:00:00Z' },
    { decision_id: 'd1', action: 'undo', at: '2026-10-07T02:00:00Z' },
    { decision_id: 'd2', action: 'not_now', at: '2026-10-07T01:00:00Z' },
    { decision_id: 'd2', action: 'wrong', at: '2026-10-07T03:00:00Z' },
  ]), { d2: 'wrong' })
})
