// Builds the upload templates served by the frontend: deno run -A scripts/make_templates.ts
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'

const out = new URL('../public/templates/', import.meta.url)
await Deno.mkdir(out, { recursive: true })

function write(name: string, sheet: string, rows: unknown[][], help: string[][]) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = rows[0].map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Panduan - Guide')
  Deno.writeFileSync(new URL(name, out), new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
}

write(
  'sales_template.xlsx',
  'Jualan',
  [
    ['Tarikh (date)', 'Nama Barang (product)', 'Kuantiti (qty)', 'Harga RM (price)'],
    ['01/10/2026', 'Milo 1kg', 2, 21.0],
    ['01/10/2026', 'Gula Pasir 1kg', 10, 2.85],
  ],
  [
    ['Lajur / Column', 'Maksud / Meaning'],
    ['Tarikh', 'Tarikh jualan, DD/MM/YYYY / Sale date, DD/MM/YYYY'],
    ['Nama Barang', 'Nama barang, sama setiap kali / Product name, spelled the same each time'],
    ['Kuantiti', 'Unit dijual (tanpa pulangan) / Units sold (no refunds)'],
    ['Harga RM', 'Harga jual seunit / Selling price per unit'],
    ['', 'Satu baris setiap jualan atau setiap hari / One row per sale or per day'],
  ],
)

write(
  'stock_template.xlsx',
  'Stok',
  [
    ['Nama Barang (product)', 'Baki Stok (on hand)', 'Harga Kos RM (unit cost)', 'Pembekal (supplier)',
      'Lead Time (days)', 'Saiz Pek (pack size)'],
    ['Milo 1kg', 24, 18.5, 'Nestle', 3, 12],
    ['Gula Pasir 1kg', 120, 2.4, 'Kilang Gula', 7, 20],
  ],
  [
    ['Lajur / Column', 'Maksud / Meaning'],
    ['Nama Barang', 'Sama seperti dalam fail jualan / Same name as in the sales file'],
    ['Baki Stok', 'Unit dalam kedai hari ini / Units in the shop today'],
    ['Harga Kos RM', 'Harga beli seunit / Purchase cost per unit'],
    ['Pembekal', 'Nama pembekal / Supplier name'],
    ['Lead Time', 'Hari dari pesan hingga sampai / Days from order to delivery'],
    ['Saiz Pek', 'Unit sekotak dari pembekal / Units per pack from the supplier'],
  ],
)
console.log('templates written to public/templates/')
