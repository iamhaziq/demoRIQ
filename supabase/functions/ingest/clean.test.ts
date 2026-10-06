import { assertEquals } from 'jsr:@std/assert@1'
import { cleanSales, cleanStock, nameKey, parseDate, parseMoney, parseQty, todayMYT } from './clean.ts'

const TODAY = '2026-10-06'

Deno.test('parseDate: DD/MM/YYYY is the Malaysian default', () => {
  assertEquals(parseDate('05/10/2026'), '2026-10-05')
  assertEquals(parseDate('5/10/26'), '2026-10-05')
  assertEquals(parseDate('05-10-2026'), '2026-10-05')
  assertEquals(parseDate('05.10.2026'), '2026-10-05')
  assertEquals(parseDate('13/01/2026 14:32'), '2026-01-13')
})

Deno.test('parseDate: ISO, month names (English and Malay), Excel serials', () => {
  assertEquals(parseDate('2026-10-05'), '2026-10-05')
  assertEquals(parseDate('2026/10/05'), '2026-10-05')
  assertEquals(parseDate('5 Okt 2026'), '2026-10-05')
  assertEquals(parseDate('5-Ogos-2026'), '2026-08-05')
  assertEquals(parseDate('1 Mac 2026'), '2026-03-01')
  assertEquals(parseDate('25 Dis 2025'), '2025-12-25')
  assertEquals(parseDate('Oct 5, 2026'), '2026-10-05')
  assertEquals(parseDate(46300), '2026-10-05') // Excel serial
})

Deno.test('parseDate: rejects impossible or out-of-range dates', () => {
  assertEquals(parseDate('31/02/2026'), null)
  assertEquals(parseDate('13/13/2026'), null)
  assertEquals(parseDate('01/01/1999'), null)
  assertEquals(parseDate('semalam'), null)
  assertEquals(parseDate(''), null)
  assertEquals(parseDate(12), null)
})

Deno.test('parseMoney strips RM and commas', () => {
  assertEquals(parseMoney('RM 1,234.50'), 1234.5)
  assertEquals(parseMoney('rm3.5'), 3.5)
  assertEquals(parseMoney('2.855'), 2.86)
  assertEquals(parseMoney(18), 18)
  assertEquals(parseMoney('(12.50)'), -12.5)
  assertEquals(parseMoney('free'), null)
  assertEquals(parseMoney('RM31,90'), null) // decimal comma: reject, never 3190
  assertEquals(parseMoney('12,34,567'), null)
})

Deno.test('parseQty strips commas and unit words', () => {
  assertEquals(parseQty('1,200'), 1200)
  assertEquals(parseQty('12 pcs'), 12)
  assertEquals(parseQty('2.5'), 2.5)
  assertEquals(parseQty('-3'), -3)
  assertEquals(parseQty('dua'), null)
  assertEquals(parseQty('1,5'), null)
})

Deno.test('nameKey merges case and spacing', () => {
  assertEquals(nameKey('  Milo   1KG '), nameKey('milo 1kg'))
})

const salesMap = { date: 'Tarikh', product: 'Barang', qty: 'Qty', price: 'Harga' }

Deno.test('cleanSales aggregates receipts per product per day and merges names', () => {
  const rows = [
    { Tarikh: '05/10/2026', Barang: 'Milo 1kg', Qty: '2', Harga: 'RM21.00' },
    { Tarikh: '05/10/2026', Barang: '  MILO  1KG', Qty: '1', Harga: 'RM21.00' },
    { Tarikh: '05/10/2026', Barang: 'Gula 1kg', Qty: '10', Harga: '2.85' },
    { Tarikh: '06/10/2026', Barang: 'milo 1kg', Qty: '3', Harga: '21' },
  ]
  const out = cleanSales(rows, salesMap, TODAY)
  assertEquals(out.rowsOk, 4)
  assertEquals(out.rejected, [])
  assertEquals(out.products.map((p) => p.name), ['Milo 1kg', 'Gula 1kg'])
  assertEquals(out.sales, [
    { product: 'Milo 1kg', date: '2026-10-05', qty: 3, revenue: 63 },
    { product: 'Gula 1kg', date: '2026-10-05', qty: 10, revenue: 28.5 },
    { product: 'Milo 1kg', date: '2026-10-06', qty: 3, revenue: 63 },
  ])
})

Deno.test('cleanSales rejects bad rows with row numbers and skips blank rows', () => {
  const rows = [
    { Tarikh: '05/10/2026', Barang: 'Milo 1kg', Qty: '-2', Harga: '21' }, // row 2
    { Tarikh: '', Barang: '', Qty: '', Harga: '' }, // row 3, blank
    { Tarikh: '31/02/2026', Barang: 'Milo 1kg', Qty: '1', Harga: '21' }, // row 4
    { Tarikh: '05/10/2026', Barang: 'Milo 1kg', Qty: '50000', Harga: '21' }, // row 5
    { Tarikh: '05/10/2026', Barang: '', Qty: '1', Harga: '21' }, // row 6
    { Tarikh: '05/10/2026', Barang: 'Milo 1kg', Qty: '1', Harga: 'percuma' }, // row 7
    { Tarikh: '07/10/2026', Barang: 'Milo 1kg', Qty: '1', Harga: '21' }, // row 8
    { Tarikh: '05/10/2026', Barang: 'Milo 1kg', Qty: '0', Harga: '21' }, // row 9, ok
  ]
  const out = cleanSales(rows, salesMap, TODAY)
  assertEquals(out.rowsOk, 1)
  assertEquals(out.rejected.map((r) => [r.row, r.reason]), [
    [2, 'negative quantity'],
    [4, 'unreadable date'],
    [5, 'quantity above 10000'],
    [6, 'missing product name'],
    [7, 'unreadable price'],
    [8, 'date is in the future'],
  ])
  assertEquals(out.sales, [{ product: 'Milo 1kg', date: '2026-10-05', qty: 0, revenue: 0 }])
})

Deno.test('cleanSales keeps revenue null when neither price nor amount is given', () => {
  const out = cleanSales([{ D: '2026-10-01', P: 'Roti', Q: 4 }], { date: 'D', product: 'P', qty: 'Q' }, TODAY)
  assertEquals(out.sales, [{ product: 'Roti', date: '2026-10-01', qty: 4, revenue: null }])
})

Deno.test('cleanSales prefers the amount column over qty x price', () => {
  const out = cleanSales(
    [{ D: '2026-10-01', P: 'Roti', Q: 4, H: 'RM3.00', J: 'RM11.00' }],
    { date: 'D', product: 'P', qty: 'Q', price: 'H', revenue: 'J' },
    TODAY,
  )
  assertEquals(out.sales[0].revenue, 11)
})

Deno.test('cleanSales reports row numbers from firstRow', () => {
  const out = cleanSales([{ Tarikh: 'x', Barang: 'A', Qty: 1 }], salesMap, TODAY, 4)
  assertEquals(out.rejected[0].row, 4)
})

const stockMap = {
  product: 'Product',
  on_hand: 'On Hand',
  unit_cost: 'Unit Cost',
  supplier: 'Supplier',
  lead_time_days: 'Lead Time',
  pack_size: 'Pack',
}

Deno.test('cleanStock defaults date to today, keeps zero stock, reads attributes', () => {
  const rows = [
    { Product: 'Milo 1kg', 'On Hand': '0', 'Unit Cost': 'RM18.50', Supplier: 'Nestle', 'Lead Time': '3 hari', Pack: '12' },
    { Product: 'Gula 1kg', 'On Hand': '120', 'Unit Cost': '2.40', Supplier: '', 'Lead Time': '', Pack: '' },
  ]
  const out = cleanStock(rows, stockMap, TODAY)
  assertEquals(out.rejected, [])
  assertEquals(out.stock, [
    { product: 'Milo 1kg', date: TODAY, on_hand: 0, on_order: 0 },
    { product: 'Gula 1kg', date: TODAY, on_hand: 120, on_order: 0 },
  ])
  assertEquals(out.products[0], {
    name: 'Milo 1kg', sku: null, category: null, unit_cost: 18.5, unit_price: null,
    supplier: 'Nestle', lead_time_days: 3, pack_size: 12,
  })
  assertEquals(out.products[1].lead_time_days, null)
})

Deno.test('cleanStock: last row wins for the same product and day; bad rows rejected', () => {
  const rows = [
    { Product: 'Milo 1kg', 'On Hand': '10' },
    { Product: 'MILO 1KG', 'On Hand': '8' },
    { Product: 'Gula', 'On Hand': '-1' },
    { Product: 'Gula', 'On Hand': '5', Pack: '0' },
    { Product: 'Gula', 'On Hand': '5', 'Lead Time': 'soon' },
  ]
  const out = cleanStock(rows, stockMap, TODAY)
  assertEquals(out.stock, [{ product: 'Milo 1kg', date: TODAY, on_hand: 8, on_order: 0 }])
  assertEquals(out.rejected.map((r) => r.reason), [
    'negative stock on hand',
    'unreadable pack size',
    'unreadable lead time',
  ])
})

Deno.test('todayMYT is UTC+8', () => {
  assertEquals(todayMYT(new Date('2026-10-05T16:30:00Z')), '2026-10-06')
  assertEquals(todayMYT(new Date('2026-10-05T15:59:00Z')), '2026-10-05')
})
