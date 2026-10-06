// Number guardrail: every number in the answer must come from this turn's tool results
// (or the owner's question). The LLM explains; it never introduces a figure.

export interface NumberToken {
  text: string
  value: number
  decimals: number
}

// 1,234.56 | 1234.56 | 12 | .5 ; optional RM prefix and % suffix are not part of the value.
const NUMBER = /(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w])|(?<![\w\d])\.\d+/g

/** Numbers written in a text. Numbered-list markers ("1." / "2)") at line start are ignored. */
export function extractNumbers(text: string): NumberToken[] {
  const cleaned = text
    .replace(/^\s*\d+[.)]\s+/gm, ' ')
    .replace(/\b(RM|MYR)(?=[\d.])/gi, '$1 ') // "RM1,496.88" -> "RM 1,496.88" so the number is seen
  const out: NumberToken[] = []
  for (const m of cleaned.matchAll(NUMBER)) {
    const raw = m[0]
    const plain = raw.replace(/,/g, '')
    const dot = plain.indexOf('.')
    out.push({ text: raw, value: Number(plain), decimals: dot === -1 ? 0 : plain.length - dot - 1 })
  }
  return out
}

/** All numbers in tool results: numeric values, plus numbers inside strings (dates, names). */
export function collectNumbers(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value)
  else if (typeof value === 'string') for (const t of extractNumbers(value)) into.push(t.value)
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, into)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, into)
  return into
}

const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

function supported(token: NumberToken, known: number[]): boolean {
  return known.some((k) =>
    roundTo(k, token.decimals) === token.value ||
    // rates stored as fractions may be written as percentages (0.08 -> 8%)
    (Math.abs(k) <= 1 && roundTo(k * 100, token.decimals) === token.value)
  )
}

export interface GuardResult {
  ok: boolean
  unsupported: string[]
}

export function checkNumbers(answer: string, toolResults: unknown[], question: string): GuardResult {
  const known = collectNumbers(toolResults)
  for (const t of extractNumbers(question)) known.push(t.value)
  const unsupported = extractNumbers(answer)
    .filter((t) => !supported(t, known))
    .map((t) => t.text)
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] }
}
