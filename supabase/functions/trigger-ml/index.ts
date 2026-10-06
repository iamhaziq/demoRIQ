// trigger-ml: start forecasting for the caller's shop. Request: POST { mode?: "predict" | "train_predict" }.
// Runs with the caller's JWT; the shop comes from the JWT (never from the browser). Holds the Modal
// proxy token (MODAL_KEY / MODAL_SECRET); no service-role key needed.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { type Mode, triggerJob } from './trigger.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'not signed in' })

  let mode: Mode = 'predict'
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.mode !== undefined) {
      if (body.mode !== 'predict' && body.mode !== 'train_predict') return json(400, { error: 'invalid mode' })
      mode = body.mode
    }
  } catch {
    return json(400, { error: 'body must be JSON' })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const result = await triggerJob((fn, args) => db.rpc(fn, args), mode, {
    url: Deno.env.get('MODAL_JOBS_URL'),
    key: Deno.env.get('MODAL_KEY'),
    secret: Deno.env.get('MODAL_SECRET'),
  })
  return json(result.status, result.body)
})
