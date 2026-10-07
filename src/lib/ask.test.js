// deno test src/lib  (fake client; no network)
import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { askAgent, AskError, displayAnswer, MAX_QUESTION } from './ask.js'

/** Client whose functions.invoke returns the given result and records what it was called with. */
function fakeClient(result) {
  const calls = []
  return {
    calls,
    functions: {
      invoke: (name, opts) => {
        calls.push({ name, body: opts.body })
        return Promise.resolve(result)
      },
    },
  }
}
const httpError = (status, body) => ({
  data: null,
  error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status }) },
})

const ANSWER = 'Order 306 units of Milo 1kg this week.\nWhy: about 4.45 days of stock left.\nWorth: RM180.54 cash required.\nSource: model v3, 2026-10-06.'

Deno.test('sends the trimmed question to agent-ask and returns the answer unchanged', async () => {
  const sb = fakeClient({ data: { answer: ANSWER, language: 'en', fallback: false, tools: ['get_reorder'] }, error: null })
  const r = await askAgent(sb, '  Should I reorder Milo?  ')
  assertEquals(sb.calls, [{ name: 'agent-ask', body: { question: 'Should I reorder Milo?' } }])
  assertEquals(r, { answer: ANSWER, language: 'en', fallback: false, tools: ['get_reorder'] })
})

Deno.test('templated fallback answers are flagged', async () => {
  const sb = fakeClient({ data: { answer: 'Tindakan hari ini: ...', language: 'ms', fallback: true, tools: [] }, error: null })
  const r = await askAgent(sb, 'Apa nak buat hari ni?')
  assertEquals([r.language, r.fallback], ['ms', true])
})

Deno.test('empty or too-long questions are not sent', async () => {
  const sb = fakeClient({ data: null, error: null })
  const e1 = await assertRejects(() => askAgent(sb, '   '), AskError)
  const e2 = await assertRejects(() => askAgent(sb, 'x'.repeat(MAX_QUESTION + 1)), AskError)
  assertEquals([e1.retry, e2.retry], [false, false])
  assertEquals(sb.calls.length, 0)
})

Deno.test('HTTP errors become owner-facing messages; only server errors offer a retry', async () => {
  const cases = [
    [401, { error: 'not signed in' }, 'Your session has ended. Sign in again to ask.', false],
    [403, { error: 'no shop for this account' }, 'This account has no shop yet.', false],
    [400, { error: 'question is required' }, 'question is required', false],
    [500, { error: 'boom' }, 'RetailIQ could not answer just now. Please try again.', true],
  ]
  for (const [status, body, message, retry] of cases) {
    const e = await assertRejects(() => askAgent(fakeClient(httpError(status, body)), 'hi'), AskError)
    assertEquals([e.message, e.retry], [message, retry])
  }
})

Deno.test('network failure and empty answers are retryable errors', async () => {
  const net = fakeClient({ data: null, error: { message: 'Failed to send a request to the Edge Function', context: new TypeError('fetch failed') } })
  const e1 = await assertRejects(() => askAgent(net, 'hi'), AskError)
  assertEquals([e1.message, e1.retry], ['Could not reach RetailIQ. Check your connection and try again.', true])
  const e2 = await assertRejects(() => askAgent(fakeClient({ data: { answer: '  ' }, error: null }), 'hi'), AskError)
  assertEquals(e2.retry, true)
})

Deno.test('display drops bold markers and blank-line runs but keeps every number as sent', () => {
  assertEquals(
    displayAnswer('**Order 306 units.**  \n\n\n\nWorth: RM1,496.88 (10%)\n'),
    'Order 306 units.\n\nWorth: RM1,496.88 (10%)',
  )
})
