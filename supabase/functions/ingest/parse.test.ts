import { assertEquals } from 'jsr:@std/assert@1'
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'
import { guessColumns } from '../_shared/columns.ts'
import { cleanSales, cleanStock } from './clean.ts'
import { readSheet } from './parse.ts'

const SAMPLES = new URL('../../../data/samples/', import.meta.url)

Deno.test('messy kedai CSV: title row skipped, Malay headers guessed, rows cleaned', async () => {
  const bytes = await Deno.readFile(new URL('kedai_sales_messy.csv', SAMPLES))
  const sheet = readSheet(bytes, 'kedai_sales_messy.csv')
  assertEquals(sheet.headers, ['Tarikh', 'Nama Barang', 'Kuantiti', 'Harga (RM)', 'Catatan'])
  assertEquals(sheet.firstRow, 3)

  const map = guessColumns(sheet.headers, 'sales')
  assertEquals(map, { date: 'Tarikh', product: 'Nama Barang', qty: 'Kuantiti', price: 'Harga (RM)' })

  const out = cleanSales(sheet.rows, map, '2026-10-06', sheet.firstRow)
  assertEquals(out.rowsOk, 9)
  assertEquals(out.rejected.map((r) => [r.row, r.reason]), [
    [6, 'unreadable price'], // "RM31,90"
    [8, 'negative quantity'], // refund
    [13, 'unreadable date'], // 31/02
    [14, 'quantity above 10000'],
    [15, 'missing product name'],
    [18, 'unreadable price'], // "percuma"
  ])
  assertEquals(out.products.map((p) => p.name), ['Milo 1kg', 'Gula Pasir 1kg', 'Roti Gardenia', 'Maggi Kari 5s'])
  assertEquals(out.sales, [
    { product: 'Milo 1kg', date: '2026-10-01', qty: 3, revenue: 63 },
    { product: 'Gula Pasir 1kg', date: '2026-10-01', qty: 10, revenue: 28.5 },
    { product: 'Milo 1kg', date: '2026-10-02', qty: 1, revenue: 21 },
    { product: 'Roti Gardenia', date: '2026-10-02', qty: 6, revenue: 21 },
    { product: 'Gula Pasir 1kg', date: '2026-10-03', qty: 8, revenue: 22.8 },
    { product: 'Maggi Kari 5s', date: '2026-10-03', qty: 3, revenue: 18.6 },
    { product: 'Milo 1kg', date: '2026-10-04', qty: 2, revenue: 42 },
    { product: 'Roti Gardenia', date: '2026-10-04', qty: 5, revenue: 17.5 },
  ])
})

Deno.test('CSV dates are never reinterpreted as US dates', () => {
  const csv = new TextEncoder().encode('Date,Product,Qty\n05/10/2026,Milo,1\n')
  const sheet = readSheet(csv, 'x.csv')
  assertEquals(sheet.rows[0].Date, '05/10/2026')
})

Deno.test('Excel file: real date cells, numeric cells, duplicate headers', () => {
  // Excel stores dates as serial day numbers with a date format: 46300 = 5 Oct 2026,
  // 46300.75 = 5 Oct 2026 18:00.
  const dateCell = (v: number) => ({ t: 'n', v, z: 'dd/mm/yyyy' })
  const ws = XLSX.utils.aoa_to_sheet([
    ['Product', 'On Hand', 'Unit Cost', 'Date', 'Date'],
    ['Milo 1kg', 0, 18.5, dateCell(46300), 'x'],
    ['Gula 1kg', 120, 2.4, dateCell(46300.75), 'y'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Stok')
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))

  const sheet = readSheet(bytes, 'stok.xlsx')
  assertEquals(sheet.headers, ['Product', 'On Hand', 'Unit Cost', 'Date', 'Date (2)'])
  const out = cleanStock(
    sheet.rows,
    { product: 'Product', on_hand: 'On Hand', unit_cost: 'Unit Cost', date: 'Date' },
    '2026-10-06',
    sheet.firstRow,
  )
  assertEquals(out.rejected, [])
  assertEquals(out.stock, [
    { product: 'Milo 1kg', date: '2026-10-05', on_hand: 0, on_order: 0 },
    { product: 'Gula 1kg', date: '2026-10-05', on_hand: 120, on_order: 0 },
  ])
  assertEquals(out.products.map((p) => p.unit_cost), [18.5, 2.4])
})
