// The agent loop: Gemini picks tools, we run them, Gemini words the answer, the guardrail checks it.
// Pure orchestration over an LLM and a ToolRunner, so tests can script both.
import type { Content, LLM, Usage } from '../_shared/llm.ts'
import { checkNumbers } from './guardrail.ts'
import { guardrailRetry, systemPrompt } from './prompt.ts'
import { detectLanguage, type Lang, renderActions, renderFromResults, UNAVAILABLE } from './templates.ts'
import { type ToolRunner, TOOLS, validateCall } from './tools.ts'

export const MAX_ROUNDS = 5
export const MAX_CALLS_PER_ROUND = 3
export const BUDGET_MS = 20_000

export interface ToolCallLog {
  name: string
  args: Record<string, unknown>
  ok: boolean
  error?: string
  ms: number
}

export interface AgentResult {
  answer: string
  language: Lang
  fallback: string | null // null = Gemini's answer passed the guardrail
  toolCalls: ToolCallLog[]
  usage: Usage
  rounds: number
  model: string | null
  latencyMs: number
}

export interface AgentInput {
  question: string
  llm: LLM | null // null = no LLM configured: templated answers only
  tools: ToolRunner
  shopLanguage?: Lang
  today: string
  budgetMs?: number
  maxRounds?: number
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const started = Date.now()
  const lang = detectLanguage(input.question, input.shopLanguage ?? 'ms')
  const usage: Usage = { prompt: 0, output: 0, thoughts: 0 }
  const toolCalls: ToolCallLog[] = []
  const results: { name: string; result: Record<string, unknown> }[] = []
  let model: string | null = null
  let rounds = 0

  const finish = (answer: string, fallback: string | null): AgentResult => ({
    answer, language: lang, fallback, toolCalls, usage, rounds, model, latencyMs: Date.now() - started,
  })

  const fallbackAnswer = async (reason: string): Promise<AgentResult> => {
    const fromResults = renderFromResults(results, lang)
    if (fromResults) return finish(fromResults, reason)
    try {
      return finish(renderActions(await input.tools.run('get_todays_actions', {}), lang), reason)
    } catch {
      return finish(UNAVAILABLE[lang], reason)
    }
  }

  if (!input.llm) return await fallbackAnswer('no_llm_configured')
  const llm = input.llm
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.budgetMs ?? BUDGET_MS)
  const system = systemPrompt(lang, input.today)
  const contents: Content[] = [{ role: 'user', parts: [{ text: input.question }] }]

  const ask = async () => {
    const res = await llm.chat(contents, { system, tools: TOOLS, signal: controller.signal })
    rounds++
    model = res.model
    usage.prompt += res.usage.prompt
    usage.output += res.usage.output
    usage.thoughts += res.usage.thoughts
    contents.push(res.content)
    return res
  }

  try {
    let answer: string | null = null
    for (let round = 0; round < (input.maxRounds ?? MAX_ROUNDS); round++) {
      const res = await ask()
      if (!res.functionCalls.length) {
        answer = res.text.trim()
        break
      }
      const parts = []
      for (const call of res.functionCalls.slice(0, MAX_CALLS_PER_ROUND)) {
        const t0 = Date.now()
        const v = validateCall(call)
        let output: Record<string, unknown>
        if (!v.ok) {
          output = { error: `rejected: ${v.error}` }
          toolCalls.push({ name: String(call.name), args: (call.args ?? {}) as Record<string, unknown>, ok: false, error: v.error, ms: 0 })
        } else {
          try {
            output = await input.tools.run(v.name, v.args)
            results.push({ name: v.name, result: output })
            toolCalls.push({ name: v.name, args: v.args, ok: true, ms: Date.now() - t0 })
          } catch (e) {
            output = { error: 'tool_failed' }
            toolCalls.push({ name: v.name, args: v.args, ok: false, error: String((e as Error)?.message ?? e), ms: Date.now() - t0 })
          }
        }
        parts.push({ functionResponse: { id: call.id, name: call.name, response: { output } } })
      }
      contents.push({ role: 'user', parts })
    }
    if (answer === null) return await fallbackAnswer('max_rounds')
    if (!answer) return await fallbackAnswer('empty_answer')

    const resultData = results.map((r) => r.result)
    let guard = checkNumbers(answer, resultData, input.question)
    if (guard.ok) return finish(answer, null)

    contents.push({ role: 'user', parts: [{ text: guardrailRetry(guard.unsupported) }] })
    const retry = await ask()
    const second = retry.functionCalls.length ? '' : retry.text.trim()
    guard = second ? checkNumbers(second, resultData, input.question) : { ok: false, unsupported: [] }
    if (guard.ok) return finish(second, null)
    return await fallbackAnswer('unsupported_numbers')
  } catch (e) {
    const reason = controller.signal.aborted ? 'timeout' : `llm_error: ${String((e as Error)?.message ?? e).slice(0, 120)}`
    return await fallbackAnswer(reason)
  } finally {
    clearTimeout(timer)
  }
}
