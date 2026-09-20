import data from './data/demo-data.json'

const cur = data.meta.currency

// Formatting only. The UI never calculates a number; every value comes from demo-data.json.
export const money = (n) =>
  `${cur}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const money0 = (n) => `${cur}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })

export const showValue = (v) => (typeof v === 'number' ? num(v) : v)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (iso) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`
}
