import { assertEquals } from 'jsr:@std/assert@1'
import { triggerJob } from './trigger.ts'

const MODAL = { url: 'https://modal.example/jobs', key: 'wk-1', secret: 'ws-1' }

function fakeRpc(enqueue: { data?: unknown; error?: { message: string } | null }) {
  const calls: [string, Record<string, unknown>][] = []
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args])
    if (fn === 'enqueue_ml_job') return Promise.resolve({ data: enqueue.data ?? null, error: enqueue.error ?? null })
    if (fn === 'current_shop_id') return Promise.resolve({ data: 'shop-1', error: null })
    return Promise.resolve({ data: null, error: null })
  }
  return { rpc, calls }
}

const created = { data: [{ job_id: 'job-1', created: true }] }

Deno.test('queues a job, calls Modal with the proxy token and the shop from the JWT', async () => {
  const { rpc, calls } = fakeRpc(created)
  let sent: { url: string; init: RequestInit } | undefined
  const fetchFn = ((url: string, init: RequestInit) => {
    sent = { url, init }
    return Promise.resolve(new Response(JSON.stringify({ call_id: 'fc-9' })))
  }) as typeof fetch
  const r = await triggerJob(rpc, 'predict', MODAL, fetchFn)
  assertEquals(r, { status: 202, body: { job_id: 'job-1', status: 'queued' } })
  assertEquals(sent!.url, MODAL.url)
  const h = sent!.init.headers as Record<string, string>
  assertEquals([h['Modal-Key'], h['Modal-Secret']], ['wk-1', 'ws-1'])
  assertEquals(JSON.parse(sent!.init.body as string), { shop_id: 'shop-1', job_id: 'job-1', mode: 'predict' })
  assertEquals(calls[0], ['enqueue_ml_job', { p_type: 'predict' }])
  assertEquals(calls.at(-1), ['attach_ml_job_call', { p_job: 'job-1', p_call_id: 'fc-9' }])
})

Deno.test('train_predict queues a train job', async () => {
  const { rpc, calls } = fakeRpc(created)
  await triggerJob(rpc, 'train_predict', MODAL, (() => Promise.resolve(new Response('{"call_id":"x"}'))) as typeof fetch)
  assertEquals(calls[0], ['enqueue_ml_job', { p_type: 'train' }])
})

Deno.test('a job already running is returned, Modal is not called again', async () => {
  const { rpc } = fakeRpc({ data: [{ job_id: 'job-0', created: false }] })
  const r = await triggerJob(rpc, 'predict', MODAL, (() => { throw new Error('must not call') }) as typeof fetch)
  assertEquals(r, { status: 200, body: { job_id: 'job-0', status: 'already_running' } })
})

Deno.test('Modal errors mark the job failed', async () => {
  for (const [fetchFn, status, msg] of [
    [() => Promise.resolve(new Response('no', { status: 401 })), 502, 'ML service returned 401'],
    [() => Promise.reject(new TypeError('connection refused')), 502, 'ML service unreachable: connection refused'],
  ] as const) {
    const { rpc, calls } = fakeRpc(created)
    const r = await triggerJob(rpc, 'predict', MODAL, fetchFn as unknown as typeof fetch)
    assertEquals(r.status, status)
    assertEquals(calls.at(-1), ['attach_ml_job_call', { p_job: 'job-1', p_call_id: null, p_error: msg }])
  }
})

Deno.test('not configured -> 503 and the job is marked failed', async () => {
  const { rpc, calls } = fakeRpc(created)
  const r = await triggerJob(rpc, 'predict', { url: MODAL.url }, fetch)
  assertEquals(r.status, 503)
  assertEquals(calls.at(-1)?.[0], 'attach_ml_job_call')
})

Deno.test('user without a shop -> 403', async () => {
  const { rpc } = fakeRpc({ error: { message: 'no shop for this user' } })
  assertEquals((await triggerJob(rpc, 'predict', MODAL, fetch)).status, 403)
})
