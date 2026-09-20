import data from './data/demo-data.json'

export default data

export const cardById = Object.fromEntries(data.cards.map((c) => [c.id, c]))
export const productBySku = Object.fromEntries(data.products.map((p) => [p.sku, p]))

// Ordering only: highest cost per day first.
export const productsByCost = [...data.products].sort((a, b) => b.cost_per_day - a.cost_per_day)

/** Match a typed question against agent_script. Returns a card, or null. Never invents an answer. */
export function matchQuestion(text) {
  const q = text.trim().toLowerCase()
  if (!q) return null
  const hit = data.agent_script.find((rule) => rule.match.some((m) => q.includes(m)))
  if (!hit) return null
  const card = cardById[hit.card]
  // A question naming a different SKU than the one the card covers must not get this card.
  const named = data.products.find((p) => q.includes(p.sku.toLowerCase()))
  if (named && named.sku !== card.sku) return null
  return card
}

/** English subtitle for a Malay question as it is typed (prefix match against malay_questions). */
export function englishFor(text) {
  const q = text.trim().toLowerCase()
  if (!q) return null
  const hit = data.malay_questions.find((m) => m.text.toLowerCase().startsWith(q))
  return hit ? hit.en : null
}
