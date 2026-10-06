// Formatting only. The UI never calculates a number; every value comes from Supabase.
const CUR = 'RM'
const missing = (n) => n === null || n === undefined || Number.isNaN(Number(n))

/** RM1,234.56; a missing value shows as "–", never as 0. */
export const money = (n) =>
  missing(n) ? '–' : `${CUR}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const money0 = (n) => (missing(n) ? '–' : `${CUR}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

export const num = (n) => (missing(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))

export const showValue = (v) => (typeof v === 'number' ? num(v) : v)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (iso) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`
}
