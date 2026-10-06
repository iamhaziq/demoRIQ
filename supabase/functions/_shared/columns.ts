// Column mapping for uploaded files. Pure TypeScript with no Deno or Node imports, so the
// frontend (Vite) and the ingest Edge Function share one copy.

export type Kind = 'sales' | 'stock'

export type Field =
  | 'date'
  | 'product'
  | 'sku'
  | 'qty'
  | 'price'
  | 'revenue'
  | 'category'
  | 'on_hand'
  | 'on_order'
  | 'unit_cost'
  | 'unit_price'
  | 'supplier'
  | 'lead_time_days'
  | 'pack_size'

/** field -> header in the uploaded file */
export type ColumnMap = Partial<Record<Field, string>>

export const FIELDS: Record<Kind, { required: Field[]; optional: Field[] }> = {
  sales: { required: ['date', 'product', 'qty'], optional: ['sku', 'price', 'revenue', 'category'] },
  stock: {
    required: ['product', 'on_hand'],
    optional: [
      'date',
      'sku',
      'on_order',
      'unit_cost',
      'unit_price',
      'supplier',
      'lead_time_days',
      'pack_size',
      'category',
    ],
  },
}

// English and Malay header names, already normalised (see normaliseHeader).
const ALIASES: Record<Field, string[]> = {
  date: ['date', 'tarikh', 'sale date', 'tarikh jualan', 'transaction date', 'tarikh transaksi', 'stock date'],
  product: [
    'product', 'product name', 'item', 'item name', 'description', 'nama barang', 'barang',
    'nama produk', 'produk', 'nama item', 'nama',
  ],
  sku: ['sku', 'barcode', 'item code', 'product code', 'kod', 'kod barang', 'kod produk'],
  qty: ['qty', 'quantity', 'kuantiti', 'kuantiti dijual', 'units sold', 'qty sold', 'unit', 'units', 'bilangan'],
  price: ['price', 'unit price', 'selling price', 'harga', 'harga seunit', 'harga jual', 'harga unit'],
  revenue: ['revenue', 'amount', 'total', 'sales', 'jumlah', 'jumlah jualan', 'nilai', 'total amount', 'net sales'],
  category: ['category', 'kategori', 'jenis', 'department'],
  on_hand: [
    'on hand', 'stock', 'stock on hand', 'qty on hand', 'stok', 'baki stok', 'stok semasa', 'baki',
    'closing stock', 'stok ada',
  ],
  on_order: ['on order', 'ordered', 'dalam pesanan', 'pesanan', 'qty on order'],
  unit_cost: ['unit cost', 'cost', 'cost price', 'harga kos', 'kos', 'harga beli', 'kos seunit'],
  unit_price: ['unit price', 'selling price', 'price', 'harga jual', 'harga', 'harga seunit'],
  supplier: ['supplier', 'vendor', 'pembekal', 'nama pembekal'],
  lead_time_days: [
    'lead time', 'lead time days', 'lead time hari', 'masa penghantaran', 'tempoh penghantaran',
    'hari penghantaran',
  ],
  pack_size: ['pack size', 'pack', 'case size', 'carton size', 'saiz pek', 'unit per pack', 'unit sekotak'],
}

/** "Nama Barang (RM)" -> "nama barang rm" */
export function normaliseHeader(h: string): string {
  return String(h)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Guess field -> header for a file. Exact alias matches are taken first, then headers that
 * contain an alias as whole words, longest alias first (so "unit price" beats "unit").
 * Each header and each field is used at most once.
 */
export function guessColumns(headers: string[], kind: Kind): ColumnMap {
  const fields = [...FIELDS[kind].required, ...FIELDS[kind].optional]
  const norm = headers.map(normaliseHeader)
  const map: ColumnMap = {}
  const used = new Set<number>()

  const take = (match: (h: string, alias: string) => boolean) => {
    const candidates: { field: Field; idx: number; len: number; rank: number }[] = []
    fields.forEach((field, rank) => {
      for (const alias of ALIASES[field]) {
        norm.forEach((h, idx) => {
          if (h !== '' && match(h, alias)) candidates.push({ field, idx, len: alias.length, rank })
        })
      }
    })
    candidates.sort((a, b) => b.len - a.len || a.rank - b.rank || a.idx - b.idx)
    for (const c of candidates) {
      if (map[c.field] || used.has(c.idx)) continue
      map[c.field] = headers[c.idx]
      used.add(c.idx)
    }
  }

  take((h, alias) => h === alias)
  take((h, alias) => ` ${h} `.includes(` ${alias} `))
  return map
}

/** Required fields missing from the map, or headers that are not in the file. */
export function validateColumnMap(map: ColumnMap, kind: Kind, headers: string[]): string[] {
  const errors: string[] = []
  const allowed = new Set<Field>([...FIELDS[kind].required, ...FIELDS[kind].optional])
  for (const f of FIELDS[kind].required) {
    if (!map[f]) errors.push(`missing column for ${f}`)
  }
  for (const [f, h] of Object.entries(map)) {
    if (!allowed.has(f as Field)) errors.push(`${f} is not a ${kind} field`)
    else if (h && !headers.includes(h)) errors.push(`column "${h}" (${f}) is not in the file`)
  }
  return errors
}
