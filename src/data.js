import data from './data/demo-data.json'

export default data

export const cardById = Object.fromEntries(data.cards.map((c) => [c.id, c]))
export const productBySku = Object.fromEntries(data.products.map((p) => [p.sku, p]))

// Ordering only: highest cost per day first.
export const productsByCost = [...data.products].sort((a, b) => b.cost_per_day - a.cost_per_day)
