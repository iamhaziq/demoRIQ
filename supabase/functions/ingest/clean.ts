// Cleaning rules for uploaded sales and stock rows. Pure functions, no I/O (see docs/ingest.md).
import type { ColumnMap } from '../_shared/columns.ts'

export type Row = Record<string, unknown>

export interface Rejected {
  row: number // spreadsheet row number
  reason: string
  values: Row
}

export interface ProductOut {
  name: string
  sku: string | null
  category: string | null
  unit_cost: number | null
  unit_price: number | null
  supplier: string | null
  lead_time_days: number | null
  pack_size: number | null
}

export interface SaleOut {
  product: string
  date: string
  qty: number
  revenue: number | null
}

export interface StockOut {
  product: string
  date: string
  on_hand: number
  on_order: number
}

export interface Cleaned {
  products: ProductOut[]
  sales: SaleOut[]
  stock: StockOut[]
  rejected: Rejected[]
  rowsOk: number
}

export const MAX_QTY = 10_000 // per row; above this is treated as a typo
export const MAX_MONEY = 1_000_000

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mac: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, ogo: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

function isoIfValid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null // e.g. 31/02
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Returns ISO yyyy-mm-dd or null. Ambiguous numeric dates are read as DD/MM (Malaysia). */
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : isoIfValid(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  if (typeof v === 'number') {
    // Excel serial date (1900 system): 45000 = 2023-03-15
    if (v < 36526 || v > 73051) return null // 2000-01-01 .. 2100-01-01
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
    return isoIfValid(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
  }
  const s = String(v).trim().toLowerCase()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[\sT])/)
  if (m) return isoIfValid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|\s)/)
  if (m) return isoIfValid(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[\s-]+([a-z]+)\.?[\s,-]+(\d{2}|\d{4})(?:$|\s)/)
  if (m && MONTHS[m[2].slice(0, 3)]) return isoIfValid(+m[3], MONTHS[m[2].slice(0, 3)], +m[1])
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:$|\s)/)
  if (m && MONTHS[m[1].slice(0, 3)]) return isoIfValid(+m[3], MONTHS[m[1].slice(0, 3)], +m[2])
  return null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * "RM 1,234.50" -> 1234.5. "(12.50)" -> -12.5. Unreadable -> null.
 * Commas must be thousands separators ("31,90" is rejected, never read as 3190).
 */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null
  if (v == null) return null
  let s = String(v).trim().toLowerCase().replace(/rm|myr|\$|\s/g, '')
  if (s.includes(',')) {
    if (!/^\(?-?\d{1,3}(,\d{3})+(\.\d+)?\)?$/.test(s)) return null
    s = s.replace(/,/g, '')
  }
  let sign = 1
  const paren = s.match(/^\((.*)\)$/)
  if (paren) {
    s = paren[1]
    sign = -1
  }
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null
  return round2(sign * Number(s))
}

/** "1,200 pcs" -> 1200. Unreadable -> null. */
export function parseQty(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round3(v) : null
  if (v == null) return null
  let s = String(v).trim().toLowerCase().replace(/\s/g, '').replace(/(pcs|pc|units?|ea|biji|keping|x)$/, '')
  if (s.includes(',')) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null
    s = s.replace(/,/g, '')
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return round3(Number(s))
}

function parseInt0(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase().replace(/\s*(days?|hari|pcs|units?)$/, '')
  if (!/^\d+(\.0+)?$/.test(s)) return null
  return Number.parseInt(s, 10)
}

/** Trim and collapse whitespace; the DB name_key is lower(this). */
export function normaliseName(v: unknown): string {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
}

export const nameKey = (name: string) => normaliseName(name).toLowerCase()

const text = (v: unknown): string | null => {
  const s = normaliseName(v)
  return s === '' ? null : s
}

const isBlank = (row: Row) => Object.values(row).every((v) => v == null || String(v).trim() === '')

/** Collects products by name key; the first spelling wins, later non-null attributes fill in. */
class ProductBook {
  private byKey = new Map<string, ProductOut>()

  add(name: string, attrs: Partial<ProductOut>): string {
    const key = nameKey(name)
    const existing = this.byKey.get(key)
    if (!existing) {
      this.byKey.set(key, {
        name,
        sku: null,
        category: null,
        unit_cost: null,
        unit_price: null,
        supplier: null,
        lead_time_days: null,
        pack_size: null,
        ...Object.fromEntries(Object.entries(attrs).filter(([, v]) => v != null)),
      })
    } else {
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) (existing as unknown as Row)[k] = v
      }
    }
    return this.byKey.get(key)!.name
  }

  list(): ProductOut[] {
    return [...this.byKey.values()]
  }
}

const get = (row: Row, map: ColumnMap, field: keyof ColumnMap) => {
  const h = map[field]
  return h ? row[h] : undefined
}

const present = (v: unknown) => v != null && String(v).trim() !== ''

/**
 * Sales rows -> one row per product per day. `today` is ISO (MYT); later dates are rejected.
 * `firstRow` is the spreadsheet row number of rows[0], for the rejected-rows report.
 */
export function cleanSales(rows: Row[], map: ColumnMap, today: string, firstRow = 2): Cleaned {
  const products = new ProductBook()
  const agg = new Map<string, SaleOut & { revenueKnown: boolean }>()
  const rejected: Rejected[] = []
  let rowsOk = 0

  rows.forEach((row, i) => {
    if (isBlank(row)) return
    const reject = (reason: string) => rejected.push({ row: i + firstRow, reason, values: row })

    const date = parseDate(get(row, map, 'date'))
    if (!date) return reject('unreadable date')
    if (date > today) return reject('date is in the future')

    const rawName = normaliseName(get(row, map, 'product'))
    if (!rawName) return reject('missing product name')

    const qty = parseQty(get(row, map, 'qty'))
    if (qty == null) return reject('unreadable quantity')
    if (qty < 0) return reject('negative quantity')
    if (qty > MAX_QTY) return reject(`quantity above ${MAX_QTY}`)

    const rawPrice = get(row, map, 'price')
    const price = present(rawPrice) ? parseMoney(rawPrice) : null
    if (present(rawPrice) && price == null) return reject('unreadable price')
    if (price != null && (price < 0 || price > MAX_MONEY)) return reject('price out of range')

    const rawRevenue = get(row, map, 'revenue')
    let revenue = present(rawRevenue) ? parseMoney(rawRevenue) : null
    if (present(rawRevenue) && revenue == null) return reject('unreadable amount')
    if (revenue != null && (revenue < 0 || revenue > MAX_MONEY)) return reject('amount out of range')
    if (revenue == null && price != null) revenue = round2(qty * price)

    const name = products.add(rawName, {
      sku: text(get(row, map, 'sku')),
      category: text(get(row, map, 'category')),
      unit_price: price,
    })

    const key = `${nameKey(name)}|${date}`
    const cur = agg.get(key)
    if (!cur) {
      agg.set(key, { product: name, date, qty, revenue: revenue ?? 0, revenueKnown: revenue != null })
    } else {
      cur.qty = round3(cur.qty + qty)
      if (revenue != null) {
        cur.revenue = round2((cur.revenue ?? 0) + revenue)
        cur.revenueKnown = true
      }
    }
    rowsOk++
  })

  const sales = [...agg.values()].map(({ revenueKnown, ...s }) => ({
    ...s,
    revenue: revenueKnown ? s.revenue : null,
  }))
  return { products: products.list(), sales, stock: [], rejected, rowsOk }
}

/** Stock rows -> one snapshot per product per day (last row wins) plus product attributes. */
export function cleanStock(rows: Row[], map: ColumnMap, today: string, firstRow = 2): Cleaned {
  const products = new ProductBook()
  const snaps = new Map<string, StockOut>()
  const rejected: Rejected[] = []
  let rowsOk = 0

  rows.forEach((row, i) => {
    if (isBlank(row)) return
    const reject = (reason: string) => rejected.push({ row: i + firstRow, reason, values: row })

    let date = today
    if (map.date) {
      const d = parseDate(get(row, map, 'date'))
      if (!d) return reject('unreadable date')
      if (d > today) return reject('date is in the future')
      date = d
    }

    const rawName = normaliseName(get(row, map, 'product'))
    if (!rawName) return reject('missing product name')

    const onHand = parseQty(get(row, map, 'on_hand'))
    if (onHand == null) return reject('unreadable stock on hand')
    if (onHand < 0) return reject('negative stock on hand')
    if (onHand > MAX_QTY * 10) return reject('stock on hand too large')

    const rawOnOrder = get(row, map, 'on_order')
    const onOrder = present(rawOnOrder) ? parseQty(rawOnOrder) : 0
    if (onOrder == null || onOrder < 0) return reject('unreadable quantity on order')

    const money = (field: 'unit_cost' | 'unit_price'): number | null | 'bad' => {
      const raw = get(row, map, field)
      if (!present(raw)) return null
      const n = parseMoney(raw)
      return n == null || n < 0 || n > MAX_MONEY ? 'bad' : n
    }
    const unitCost = money('unit_cost')
    if (unitCost === 'bad') return reject('unreadable unit cost')
    const unitPrice = money('unit_price')
    if (unitPrice === 'bad') return reject('unreadable unit price')

    const rawLead = get(row, map, 'lead_time_days')
    const lead = present(rawLead) ? parseInt0(rawLead) : null
    if (present(rawLead) && (lead == null || lead > 365)) return reject('unreadable lead time')

    const rawPack = get(row, map, 'pack_size')
    const pack = present(rawPack) ? parseInt0(rawPack) : null
    if (present(rawPack) && (pack == null || pack < 1)) return reject('unreadable pack size')

    const name = products.add(rawName, {
      sku: text(get(row, map, 'sku')),
      category: text(get(row, map, 'category')),
      unit_cost: unitCost,
      unit_price: unitPrice,
      supplier: text(get(row, map, 'supplier')),
      lead_time_days: lead,
      pack_size: pack,
    })

    snaps.set(`${nameKey(name)}|${date}`, { product: name, date, on_hand: onHand, on_order: onOrder })
    rowsOk++
  })

  return { products: products.list(), sales: [], stock: [...snaps.values()], rejected, rowsOk }
}

export { todayMYT } from '../_shared/dates.ts'
