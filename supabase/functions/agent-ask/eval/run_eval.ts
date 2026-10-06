// Bilingual eval against the REAL model with canned tool data (no database).
// Run after every prompt or model change:
//   deno run -A supabase/functions/agent-ask/eval/run_eval.ts [--verbose]
// Reads GEMINI_API_KEY from the environment or supabase/functions/.env.
import { geminiLLM, MODEL_ID } from '../../_shared/llm.ts'
import { runAgent } from '../agent.ts'
import type { ToolRunner } from '../tools.ts'

const here = new URL('.', import.meta.url)
const verbose = Deno.args.includes('--verbose')

function loadKey(): string | undefined {
  if (Deno.env.get('GEMINI_API_KEY')) return Deno.env.get('GEMINI_API_KEY')
  try {
    const env = Deno.readTextFileSync(new URL('../../.env', here))
    const line = env.split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='))
    return line?.slice('GEMINI_API_KEY='.length).trim().replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

const SOURCE = { model_version: 3, model_type: 'lightgbm', run_date: '2026-10-06' }
const SHOP: Record<string, { id: string; name: string }> = {
  milo: { id: 'p1', name: 'Milo 1kg' },
  gula: { id: 'p2', name: 'Gula Pasir 1kg' },
  sugar: { id: 'p2', name: 'Gula Pasir 1kg' },
  kopi: { id: 'p3', name: 'Kopi Tongkat 200g' },
  coffee: { id: 'p3', name: 'Kopi Tongkat 200g' },
  maggi: { id: 'p4', name: 'Maggi Kari 5s' },
  roti: { id: 'p5', name: 'Roti Gardenia' },
}
const find = (q: string) => Object.entries(SHOP).find(([k]) => q.toLowerCase().includes(k))?.[1]

const canned: ToolRunner = {
  run(name, args) {
    const p = args.product ?? args.name ?? ''
    const product = find(p)
    const notFound = { error: 'product_not_found', query: p, suggestions: [] }
    const out: Record<string, unknown> = (() => {
      switch (name) {
        case 'get_todays_actions':
          return {
            actions: [
              { type: 'CLEAR', product: 'Kopi Tongkat 200g', qty: 175, value_rm: 1496.88,
                details: { discount_pct: 10, break_even_discount_pct: 34.5, cash_released: 1496.88 } },
              { type: 'REORDER', product: 'Milo 1kg', qty: 306, value_rm: 180.54,
                details: { days_of_cover: 4.45, lead_time_days: 7 } },
            ],
            source: SOURCE,
          }
        case 'get_true_cost':
          if (p.toLowerCase().includes('slow')) {
            return { slow_stock: [{ product: 'Kopi Tongkat 200g', stock_value: 1540, cost_per_day: 1.67, annual_cost: 610.2 }],
              products: 1, total_stock_value: 1540, total_cost_per_day: 1.67, total_annual_cost: 610.2, source: SOURCE }
          }
          return product
            ? { product: product.name, true_cost: { stock_value: 1540, cost_per_day: 1.67, annual_cost: 610.2,
                components_annual: { financing: 33.43, space: 131.25, service: 46.2, risk: 231, opportunity: 168.32 } }, source: SOURCE }
            : notFound
        case 'get_reorder':
          return product
            ? { product: product.name, decision: 'REORDER', qty: 306, cash_required: 180.54,
                details: { days_of_cover: 4.45, lead_time_days: 7, demand_over_lead_and_review: 289.5, safety_stock: 108.05 }, source: SOURCE }
            : notFound
        case 'get_clearance':
          return product
            ? { product: product.name, decision: 'CLEAR', details: { discount_pct: 10, break_even_discount_pct: 34.5,
                cash_released: 1496.88, holding_cost_total: 302.4, holding_days: 180 }, source: SOURCE }
            : notFound
        case 'get_forecast':
          return product
            ? { product: product.name, weeks: 4, low_confidence: false, source: SOURCE,
                forecast: [
                  { week_start: '2026-10-07', low: 128.2, likely: 144.8, high: 162.1 },
                  { week_start: '2026-10-14', low: 125.6, likely: 141.3, high: 158.4 },
                  { week_start: '2026-10-21', low: 130.1, likely: 147.9, high: 166.0 },
                  { week_start: '2026-10-28', low: 139.5, likely: 158.2, high: 177.3 },
                ] }
            : notFound
        case 'find_product':
          return { matches: Object.values(SHOP).filter((s) => s.name.toLowerCase().includes(p.toLowerCase().slice(0, 4))).map((s) => ({ name: s.name })) }
        case 'get_data_status':
          return { model: { version: 3, type: 'lightgbm', wape_pct: 21.34, baseline_wape_pct: 24.1, trained_through: '2026-10-05', created: '2026-10-06' },
            last_upload: { kind: 'sales', date: '2026-10-05', rows_ok: 4210, rows_rejected: 12, days_of_history: 182 },
            low_confidence_products: 3, low_confidence_examples: ['Roti Gardenia'] }
        default:
          return { error: 'unknown tool' }
      }
    })()
    return Promise.resolve(out)
  },
}

const questions = JSON.parse(await Deno.readTextFile(new URL('questions.json', here))) as
  { q: string; tool: string | null; arg?: string; lang: 'ms' | 'en' }[]
const llm = geminiLLM(loadKey())
let pass = 0
const rows: string[] = []
const latencies: number[] = []
let tokens = 0

for (const item of questions) {
  const r = await runAgent({ question: item.q, llm, tools: canned, today: '2026-10-07', shopLanguage: 'ms' })
  const first = r.toolCalls.find((c) => c.ok)
  const toolOk = item.tool === null ? !first : first?.name === item.tool && (!item.arg || String(first?.args.product) === item.arg)
  const langOk = r.language === item.lang
  const guardOk = r.fallback === null
  const ok = toolOk && langOk && guardOk
  if (ok) pass++
  latencies.push(r.latencyMs)
  tokens += r.usage.prompt + r.usage.output + r.usage.thoughts
  rows.push(`${ok ? 'PASS' : 'FAIL'} | ${item.q} | tool ${first?.name ?? '-'}${toolOk ? '' : ` (want ${item.tool})`} | ` +
    `lang ${r.language}${langOk ? '' : ' (!)'} | ${r.fallback ?? 'answered'} | ${r.latencyMs} ms`)
  if (verbose || !ok) rows.push(`       ${r.answer.replace(/\n/g, '\n       ')}`)
}

latencies.sort((a, b) => a - b)
console.log(rows.join('\n'))
console.log(`\nmodel ${MODEL_ID}: ${pass}/${questions.length} passed; ` +
  `median ${latencies[Math.floor(latencies.length / 2)]} ms, max ${latencies.at(-1)} ms; ${tokens} tokens total`)
Deno.exit(pass === questions.length ? 0 : 1)
