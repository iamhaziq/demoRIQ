import { assertEquals } from 'jsr:@std/assert@1'
import { guessColumns, normaliseHeader, validateColumnMap } from './columns.ts'

Deno.test('normaliseHeader strips punctuation and case', () => {
  assertEquals(normaliseHeader('  Nama Barang (RM) '), 'nama barang rm')
  assertEquals(normaliseHeader('Kuantiti_Dijual'), 'kuantiti dijual')
})

Deno.test('guesses Malay sales headers', () => {
  const headers = ['Tarikh', 'Nama Barang', 'Kuantiti', 'Harga (RM)', 'Catatan']
  assertEquals(guessColumns(headers, 'sales'), {
    date: 'Tarikh',
    product: 'Nama Barang',
    qty: 'Kuantiti',
    price: 'Harga (RM)',
  })
})

Deno.test('guesses English POS export headers', () => {
  const headers = ['Transaction Date', 'Item Code', 'Item Name', 'Qty Sold', 'Unit Price', 'Total Amount']
  assertEquals(guessColumns(headers, 'sales'), {
    date: 'Transaction Date',
    sku: 'Item Code',
    product: 'Item Name',
    qty: 'Qty Sold',
    price: 'Unit Price',
    revenue: 'Total Amount',
  })
})

Deno.test('longer alias wins: "Unit Price" is price, not qty', () => {
  const map = guessColumns(['Date', 'Product', 'Units', 'Unit Price'], 'sales')
  assertEquals(map.qty, 'Units')
  assertEquals(map.price, 'Unit Price')
})

Deno.test('guesses stock template headers', () => {
  const headers = ['Product', 'On Hand', 'Unit Cost', 'Supplier', 'Lead Time (days)', 'Pack Size']
  assertEquals(guessColumns(headers, 'stock'), {
    product: 'Product',
    on_hand: 'On Hand',
    unit_cost: 'Unit Cost',
    supplier: 'Supplier',
    lead_time_days: 'Lead Time (days)',
    pack_size: 'Pack Size',
  })
})

Deno.test('guesses Malay stock headers', () => {
  const headers = ['Nama Barang', 'Baki Stok', 'Harga Kos', 'Pembekal']
  assertEquals(guessColumns(headers, 'stock'), {
    product: 'Nama Barang',
    on_hand: 'Baki Stok',
    unit_cost: 'Harga Kos',
    supplier: 'Pembekal',
  })
})

Deno.test('validateColumnMap reports missing and unknown columns', () => {
  const headers = ['Tarikh', 'Barang']
  assertEquals(validateColumnMap({ date: 'Tarikh', product: 'Barang' }, 'sales', headers), [
    'missing column for qty',
  ])
  assertEquals(validateColumnMap({ date: 'Tarikh', product: 'Barang', qty: 'Qty' }, 'sales', headers), [
    'column "Qty" (qty) is not in the file',
  ])
  assertEquals(
    validateColumnMap({ product: 'Barang', on_hand: 'Tarikh', qty: 'Tarikh' }, 'stock', headers),
    ['qty is not a stock field'],
  )
})

Deno.test('RetailIQ template headers map fully', () => {
  assertEquals(
    guessColumns(['Tarikh (date)', 'Nama Barang (product)', 'Kuantiti (qty)', 'Harga RM (price)'], 'sales'),
    { date: 'Tarikh (date)', product: 'Nama Barang (product)', qty: 'Kuantiti (qty)', price: 'Harga RM (price)' },
  )
  assertEquals(
    guessColumns([
      'Nama Barang (product)', 'Baki Stok (on hand)', 'Harga Kos RM (unit cost)', 'Pembekal (supplier)',
      'Lead Time (days)', 'Saiz Pek (pack size)',
    ], 'stock'),
    {
      product: 'Nama Barang (product)',
      on_hand: 'Baki Stok (on hand)',
      unit_cost: 'Harga Kos RM (unit cost)',
      supplier: 'Pembekal (supplier)',
      lead_time_days: 'Lead Time (days)',
      pack_size: 'Saiz Pek (pack size)',
    },
  )
})
