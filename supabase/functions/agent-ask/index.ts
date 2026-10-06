// agent-ask: answer an owner's question from their shop's stored results.
// Request: POST { question: string }. Runs with the caller's JWT (RLS = their shop only).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { geminiLLM, type LLM } from '../_shared/llm.ts'
import { todayMYT } from '../_shared/dates.ts'
import { runAgent } from './agent.ts'
import { dbTools } from './tools.ts'

const MAX_QUESTION = 500

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

let llm: LLM | null | undefined
function getLLM(): LLM | null {
  if (llm === undefined) {
    try {
      llm = geminiLLM()
    } catch {
      llm = null // no key configured: templated answers only
    }
  }
  return llm
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'not signed in' })

  let question: unknown
  try {
    question = (await req.json())?.question
  } catch {
    return json(400, { error: 'body must be JSON' })
  }
  if (typeof question !== 'string' || !question.trim()) return json(400, { error: 'question is required' })
  if (question.length > MAX_QUESTION) return json(400, { error: `question is longer than ${MAX_QUESTION} characters` })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  // The anon key alone is a valid JWT but no user: answer 401, not a permission error from the shops query.
  const { data: auth } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
  if (!auth?.user) return json(401, { error: 'not signed in' })
  const { data: shop, error: shopErr } = await db.from('shops').select('id, language, agent_log_consent').maybeSingle()
  if (shopErr) return json(500, { error: shopErr.message })
  if (!shop) return json(403, { error: 'no shop for this account' })

  const today = todayMYT()
  const result = await runAgent({
    question: question.trim(),
    llm: getLLM(),
    tools: dbTools(db, today),
    shopLanguage: shop.language,
    today,
  })

  if (shop.agent_log_consent) {
    const { error } = await db.from('agent_logs').insert({
      shop_id: shop.id,
      question: question.trim(),
      language: result.language,
      tool_calls: result.toolCalls,
      answer: result.answer,
      fallback: result.fallback,
      model: result.model,
      latency_ms: result.latencyMs,
      prompt_tokens: result.usage.prompt,
      output_tokens: result.usage.output,
      thoughts_tokens: result.usage.thoughts,
    })
    if (error) console.error('agent_logs insert failed', error.message)
  }

  return json(200, {
    answer: result.answer,
    language: result.language,
    fallback: result.fallback !== null,
    tools: result.toolCalls.filter((c) => c.ok).map((c) => c.name),
  })
})
