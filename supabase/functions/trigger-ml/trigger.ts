// Queue a job for the caller's shop and hand it to Modal. Pure over injected rpc/fetch for tests.

export type Mode = 'predict' | 'train_predict'
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>

export interface ModalConfig {
  url?: string
  key?: string
  secret?: string
}

export interface TriggerResult {
  status: number
  body: Record<string, unknown>
}

export const MODAL_TIMEOUT_MS = 10_000

export async function triggerJob(rpc: Rpc, mode: Mode, modal: ModalConfig, fetchFn: typeof fetch = fetch): Promise<TriggerResult> {
  const { data, error } = await rpc('enqueue_ml_job', { p_type: mode === 'train_predict' ? 'train' : 'predict' })
  if (error) return { status: error.message.includes('no shop') ? 403 : 500, body: { error: error.message } }
  const { job_id, created } = (Array.isArray(data) ? data[0] : data) as { job_id: string; created: boolean }
  if (!created) return { status: 200, body: { job_id, status: 'already_running' } }

  const fail = async (status: number, message: string) => {
    await rpc('attach_ml_job_call', { p_job: job_id, p_call_id: null, p_error: message })
    return { status, body: { job_id, error: message } }
  }
  if (!modal.url || !modal.key || !modal.secret) return await fail(503, 'ML service is not configured')

  // The shop id comes from the caller's JWT (current_shop_id), never from the request body.
  const { data: shopId, error: shopErr } = await rpc('current_shop_id', {})
  if (shopErr || !shopId) return await fail(500, 'could not resolve shop')

  try {
    const res = await fetchFn(modal.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Modal-Key': modal.key, 'Modal-Secret': modal.secret },
      body: JSON.stringify({ shop_id: shopId, job_id, mode }),
      signal: AbortSignal.timeout(MODAL_TIMEOUT_MS),
    })
    if (!res.ok) return await fail(502, `ML service returned ${res.status}`)
    const { call_id } = await res.json()
    await rpc('attach_ml_job_call', { p_job: job_id, p_call_id: String(call_id) })
    return { status: 202, body: { job_id, status: 'queued' } }
  } catch (e) {
    return await fail(502, `ML service unreachable: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
  }
}
