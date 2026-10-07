// deno test src/lib  (pure mapping; no network)
import { assertEquals } from 'jsr:@std/assert@1'
import { costDetail, costRows, holdOrClear } from './stockCost.js'
import { pct } from '../format.js'

// Deck example (Kopi Tongkat): 175 units, RM1,540 at cost, 39.62% a year to hold.
const metric = {
  product_id: 'p2', as_of: '2026-10-06', on_hand: '175.000', stock_value: 1540, age_days: 94, days_of_cover: null,
  cost_components: { financing: 123.2, space: 77, service: 46.2, risk: 184.8, opportunity: 179 },
  annual_cost: 610.2, carrying_rate: 0.3962, cost_per_day: 1.67, cost_30d: 50.15, cost_180d: 300.92, slow_stock: true,
}

Deno.test('table row keeps stored values; unknown age and cover stay missing, not 0', () => {
  assertEquals(costRows([metric], [{ id: 'p2', sku: null, name: 'Kopi Tongkat 200g' }]), [{
    id: 'p2', name: 'Kopi Tongkat 200g', sku: null, onHand: 175, stockValue: 1540, ageDays: 94, daysOfCover: null,
    costPerDay: 1.67, cost30d: 50.15, slow: true,
  }])
  assertEquals(costRows([{ ...metric, age_days: null }], [])[0].ageDays, null)
})

Deno.test('breakdown: the 365-day cost is the stored annual cost; rate shows as a percentage', () => {
  const d = costDetail(metric)
  assertEquals(d.horizon, { day: 1.67, d30: 50.15, d180: 300.92, d365: 610.2 })
  assertEquals(d.components.risk, 184.8)
  assertEquals(pct(d.carryingRate), '39.6%')
})

const clear = {
  type: 'CLEAR',
  reason_json: {
    hold_or_clear: {
      decision: 'CLEAR', units: 175, holding_days: 180, holding_cost_per_unit: 1.73, holding_cost_total: 302.4,
      loan_rate: 0.08, clearance_sell_through_assumed: 0.8,
      by_sell_through: [
        { sell_through: 0.5, break_even_discount_pct: 64.5, discount_pct: 10, clear_at_any_discount: false,
          cash_released: 935.55, interest_avoided_per_year: 74.84 },
        { sell_through: 0.8, break_even_discount_pct: 34.5, discount_pct: 10, clear_at_any_discount: false,
          cash_released: 1496.88, interest_avoided_per_year: 119.75 },
        { sell_through: 0.95, break_even_discount_pct: 105, discount_pct: null, clear_at_any_discount: true,
          cash_released: 1777.55, interest_avoided_per_year: 142.2 },
      ],
    },
  },
}

Deno.test('slider starts at the assumed sell-through and shows that row\'s stored figures', () => {
  const h = holdOrClear(clear, 'Kopi Tongkat 200g')
  assertEquals(h.start, 1)
  assertEquals(h.rows[1], {
    sellThrough: 0.8, breakEvenPct: 34.5, clearAtAnyDiscount: false, discountPct: 10, cashReleased: 1496.88,
    interestAvoided: 119.75, draft: 'Kopi Tongkat 200g: 10% off while stocks last. 175 units available in store.',
  })
  assertEquals([h.holdingCostTotal, pct(h.loanRate)], [302.4, '8%'])
  assertEquals([h.rows[2].clearAtAnyDiscount, h.rows[2].draft], [true, null])
})

Deno.test('no hold-or-clear decision means no slider', () => {
  assertEquals(holdOrClear(undefined, 'Milo'), null)
  assertEquals(holdOrClear({ type: 'REORDER', reason_json: {} }, 'Milo'), null)
})
