import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import type { ChatOptions, ChatResult, Content, LLM } from '../_shared/llm.ts'
import { LLMError } from '../_shared/llm.ts'
import { runAgent } from './agent.ts'
import { checkNumbers, extractNumbers } from './guardrail.ts'
import { detectLanguage, renderActions, renderReorder } from './templates.ts'
import { type ToolRunner, validateCall } from './tools.ts'

// ---- fixtures -------------------------------------------------------------------------------

const SOURCE = { model_version: 3, model_type: 'lightgbm', run_date: '2026-10-06' }
const REORDER = {
  product: 'Milo 1kg', decision: 'REORDER', qty: 306, cash_required: 180.54,
  details: { days_of_cover: 4.45, lead_time_days: 7, safety_stock: 108.05 }, source: SOURCE,
}
const ACTIONS = {
  actions: [
    { type: 'CLEAR', product: 'Kopi Tongkat 200g', qty: 175, value_rm: 1496.88, details: { discount_pct: 10, break_even_discount_pct: 34.5 } },
    { type: 'REORDER', product: 'Milo 1kg', qty: 306, value_rm: 180.54, details: { days_of_cover: 4.45 } },
  ],
  source: SOURCE,
}

function fakeTools(data: Record<string, Record<string, unknown>> = {}): ToolRunner & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    run(name, args) {
      calls.push(`${name}(${Object.values(args).join(',')})`)
      if (name === 'boom') throw new Error('db down')
      return Promise.resolve(data[name] ?? { error: 'no_data' })
    },
  }
}

type Step = { call?: { name: string; args?: Record<string, unknown> }[]; text?: string } | Error

/** An LLM that replays a script, one step per chat() call, and records what it was sent. */
function scripted(steps: Step[]): LLM & { seen: Content[][] } {
  const seen: Content[][] = []
  let i = 0
  return {
    seen,
    chat(contents: Content[], _opts: ChatOptions): Promise<ChatResult> {
      seen.push(structuredClone(contents))
      const step = steps[i++]
      if (!step) throw new Error('script exhausted')
      if (step instanceof Error) return Promise.reject(step)
      const functionCalls = (step.call ?? []).map((c, k) => ({ id: `c${i}${k}`, name: c.name, args: c.args ?? {} }))
      const parts = functionCalls.length ? functionCalls.map((fc) => ({ functionCall: fc })) : [{ text: step.text ?? '' }]
      return Promise.resolve({
        content: { role: 'model', parts }, functionCalls, text: step.text ?? '',
        usage: { prompt: 10, output: 5, thoughts: 2 }, latencyMs: 1, model: 'fake',
      })
    },
  }
}

const TODAY = '2026-10-07'

// ---- agent loop ----------------------------------------------------------------------------

Deno.test('tool call then grounded answer passes the guardrail', async () => {
  const tools = fakeTools({ get_reorder: REORDER })
  const llm = scripted([
    { call: [{ name: 'get_reorder', args: { product: 'milo' } }] },
    { text: 'Order 306 units of Milo 1kg.\nWhy: 4.45 days of stock, 7-day lead time.\nWorth: RM180.54.\nSource: model v3, 2026-10-06.' },
  ])
  const r = await runAgent({ question: 'Should I reorder Milo?', llm, tools, today: TODAY })
  assertEquals(r.fallback, null)
  assertEquals(r.language, 'en')
  assertEquals(tools.calls, ['get_reorder(milo)'])
  assertEquals(r.rounds, 2)
  assertEquals(r.usage, { prompt: 20, output: 10, thoughts: 4 })
  // the tool result went back to Gemini as a functionResponse with the call id
  const fr = llm.seen[1].at(-1)!.parts![0].functionResponse!
  assertEquals([fr.id, fr.name], ['c10', 'get_reorder'])
})

Deno.test('invented number -> one retry naming it -> fixed answer accepted', async () => {
  const llm = scripted([
    { call: [{ name: 'get_reorder', args: { product: 'Milo' } }] },
    { text: 'Order 306 units. You will save RM50.00.' },
    { text: 'Order 306 units of Milo 1kg for RM180.54.' },
  ])
  const r = await runAgent({ question: 'reorder milo?', llm, tools: fakeTools({ get_reorder: REORDER }), today: TODAY })
  assertEquals(r.fallback, null)
  assertEquals(r.answer, 'Order 306 units of Milo 1kg for RM180.54.')
  assertMatch(llm.seen[2].at(-1)!.parts![0].text!, /50\.00/)
})

Deno.test('invented number twice -> templated answer from the data', async () => {
  const llm = scripted([
    { call: [{ name: 'get_reorder', args: { product: 'Milo' } }] },
    { text: 'Order 300 units.' },
    { text: 'Order about 310 units.' },
  ])
  const r = await runAgent({ question: 'Perlu order Milo tak?', llm, tools: fakeTools({ get_reorder: REORDER }), today: TODAY })
  assertEquals(r.fallback, 'unsupported_numbers')
  assertEquals(r.language, 'ms')
  assertEquals(r.answer, renderReorder(REORDER, 'ms'))
})

Deno.test('unknown tool and bad arguments are rejected, not run', async () => {
  const tools = fakeTools({ get_todays_actions: ACTIONS })
  const llm = scripted([
    { call: [{ name: 'drop_tables' }, { name: 'get_reorder', args: { product: 'Milo', shop_id: 'other' } }] },
    { call: [{ name: 'get_todays_actions' }] },
    { text: 'Clear Kopi Tongkat 200g at 10% off; it releases RM1,496.88.' },
  ])
  const r = await runAgent({ question: 'what should I do today', llm, tools, today: TODAY })
  assertEquals(tools.calls, ['get_todays_actions()'])
  assertEquals(r.toolCalls.map((c) => [c.name, c.ok]), [['drop_tables', false], ['get_reorder', false], ['get_todays_actions', true]])
  const rejected = llm.seen[1].at(-1)!.parts!.map((p) => (p.functionResponse!.response as { output: { error: string } }).output.error)
  assertEquals(rejected, ['rejected: unknown tool: drop_tables', 'rejected: unknown argument: shop_id'])
  assertEquals(r.fallback, null)
})

Deno.test('stops after 5 rounds and answers from the data it has', async () => {
  const loop = { call: [{ name: 'get_todays_actions' }] }
  const llm = scripted([loop, loop, loop, loop, loop, loop])
  const r = await runAgent({ question: 'apa nak buat hari ni', llm, tools: fakeTools({ get_todays_actions: ACTIONS }), today: TODAY })
  assertEquals(r.rounds, 5)
  assertEquals(r.fallback, 'max_rounds')
  assertEquals(r.answer, renderActions(ACTIONS, 'ms'))
})

Deno.test('Gemini down (429) -> today\'s actions from the database', async () => {
  const tools = fakeTools({ get_todays_actions: ACTIONS })
  const r = await runAgent({
    question: 'What should I do today?', llm: scripted([new LLMError('rate limited', 429)]), tools, today: TODAY,
  })
  assertMatch(r.fallback!, /^llm_error/)
  assertEquals(tools.calls, ['get_todays_actions()'])
  assertEquals(r.answer, renderActions(ACTIONS, 'en'))
})

Deno.test('slow model hits the time budget -> fallback', async () => {
  const slow: LLM = {
    chat: (_c, { signal }) => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')))),
  }
  const r = await runAgent({ question: 'today?', llm: slow, tools: fakeTools({ get_todays_actions: ACTIONS }), today: TODAY, budgetMs: 50 })
  assertEquals(r.fallback, 'timeout')
})

Deno.test('no LLM configured -> templated answers only', async () => {
  const r = await runAgent({ question: 'today?', llm: null, tools: fakeTools({ get_todays_actions: { actions: [] } }), today: TODAY })
  assertEquals(r.fallback, 'no_llm_configured')
  assertMatch(r.answer, /Upload your sales/)
})

Deno.test('a failing tool is reported to Gemini, not thrown', async () => {
  const llm = scripted([{ call: [{ name: 'get_data_status' }] }, { text: 'I could not read the data status right now.' }])
  const tools: ToolRunner = { run: () => Promise.reject(new Error('db down')) }
  const r = await runAgent({ question: 'how accurate is the forecast?', llm, tools, today: TODAY })
  assertEquals(r.toolCalls[0].ok, false)
  assertEquals(r.fallback, null)
})

// ---- validation ----------------------------------------------------------------------------

Deno.test('validateCall', () => {
  assertEquals(validateCall({ name: 'get_reorder', args: { product: ' Milo ' } }), { ok: true, name: 'get_reorder', args: { product: 'Milo' } })
  assertEquals(validateCall({ name: 'get_todays_actions' }), { ok: true, name: 'get_todays_actions', args: {} })
  assertEquals(validateCall({ name: 'get_reorder', args: {} }), { ok: false, error: 'missing argument: product' })
  assertEquals(validateCall({ name: 'get_reorder', args: { product: 5 } }), { ok: false, error: 'argument product must be text' })
  assertEquals(validateCall({ name: 'get_reorder', args: { product: 'x'.repeat(101) } }).ok, false)
  assertEquals(validateCall({ name: 'sql', args: {} }), { ok: false, error: 'unknown tool: sql' })
})

// ---- guardrail ----------------------------------------------------------------------------

Deno.test('extractNumbers reads RM, commas, decimals, percents; ignores list markers', () => {
  assertEquals(
    extractNumbers('1. Clear at 10% off: RM1,496.88\n2) Order 306 units').map((t) => [t.value, t.decimals]),
    [[10, 0], [1496.88, 2], [306, 0]],
  )
  assertEquals(extractNumbers('model v3 (P50)').length, 0)
})

Deno.test('checkNumbers: exact, rounded, percent-of-fraction, dates, question numbers', () => {
  const results = [{ cash: 1496.88, rate: 0.08, wape: 0.2134, date: '2026-10-06', qty: 306 }]
  assert(checkNumbers('RM1,496.88 released', results, '').ok)
  assert(checkNumbers('about RM1,497', results, '').ok) // written at lower precision
  assert(checkNumbers('at an 8% loan rate', results, '').ok)
  assert(checkNumbers('updated 2026-10-06', results, '').ok)
  assert(checkNumbers('for your 3 shops', results, 'I have 3 shops').ok)
  assertEquals(checkNumbers('order 310 units for RM200.00', results, ''), { ok: false, unsupported: ['310', '200.00'] })
  assertEquals(checkNumbers('RM1,496.90', results, '').ok, false) // wrong at the precision written
})

// ---- language and templates -----------------------------------------------------------------

Deno.test('detectLanguage', () => {
  assertEquals(detectLanguage('Berapa kos stok perlahan saya?', 'en'), 'ms')
  assertEquals(detectLanguage('Apa nak order minggu ni?', 'en'), 'ms')
  assertEquals(detectLanguage('What should I order this week?', 'ms'), 'en')
  assertEquals(detectLanguage('Milo 1kg', 'ms'), 'ms') // no clue -> shop language
})

Deno.test('templates format money with RM and 2 decimals and cite the source', () => {
  const t = renderReorder(REORDER, 'en')
  assertMatch(t, /^Order 306 units of Milo 1kg\./)
  assertMatch(t, /RM180\.54/)
  assertMatch(t, /Source: model v3 \(lightgbm\), 2026-10-06/)
  assertMatch(renderActions(ACTIONS, 'ms'), /RM1,496\.88/)
  // templates only reformat tool numbers
  assert(checkNumbers(renderActions(ACTIONS, 'en'), [ACTIONS], '').ok)
})
