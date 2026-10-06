// The only file that calls the Gemini API. Model changes, retries and a future provider
// switch touch this file only (CLAUDE.md).
import { type Content, type FunctionCall, GoogleGenAI } from 'npm:@google/genai@2.27.0'

// Pinned model. Stable, no shutdown date announced (checked 2026-10-07). gemini-3.8-flash is
// Google's newest default but returned 503 "high demand" on every call during setup.
// Re-check https://ai.google.dev/gemini-api/docs/deprecations monthly.
export const MODEL_ID = 'gemini-3.6-flash'

export const CALL_TIMEOUT_MS = 12_000
export const MAX_OUTPUT_TOKENS = 2048 // includes thinking tokens
const RETRYABLE = new Set([429, 500, 503, 504])
const RETRY_DELAY_MS = 800

export type { Content, FunctionCall }

export interface ToolDeclaration {
  name: string
  description: string
  parametersJsonSchema: Record<string, unknown>
}

export interface Usage {
  prompt: number
  output: number
  thoughts: number
}

export interface ChatResult {
  content: Content // the model's turn, appended to history as-is (keeps thought signatures)
  functionCalls: FunctionCall[]
  text: string
  usage: Usage
  latencyMs: number
  model: string
}

export interface ChatOptions {
  system: string
  tools: ToolDeclaration[]
  signal?: AbortSignal
}

export interface LLM {
  chat(contents: Content[], opts: ChatOptions): Promise<ChatResult>
}

export class LLMError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'LLMError'
  }
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status
  if (typeof s === 'number') return s
  const m = String((e as Error)?.message ?? '').match(/"code":\s*(\d{3})/)
  return m ? Number(m[1]) : undefined
}

export function geminiLLM(apiKey = Deno.env.get('GEMINI_API_KEY')): LLM {
  if (!apiKey) throw new LLMError('GEMINI_API_KEY is not set')
  const ai = new GoogleGenAI({ apiKey })

  return {
    async chat(contents, { system, tools, signal }) {
      for (let attempt = 1; ; attempt++) {
        const started = Date.now()
        try {
          const res = await ai.models.generateContent({
            model: MODEL_ID,
            contents,
            config: {
              systemInstruction: system,
              tools: [{ functionDeclarations: tools }],
              // Google advises keeping Gemini 3+ at its default temperature; consistency comes
              // from the tools and the number guardrail instead.
              thinkingConfig: { thinkingLevel: 'LOW' as never },
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              abortSignal: signal,
              httpOptions: { timeout: CALL_TIMEOUT_MS },
            },
          })
          const content = res.candidates?.[0]?.content
          if (!content) throw new LLMError(`empty response (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`)
          const u = res.usageMetadata
          // Text parts only (not thoughts); reading res.text with function calls present logs warnings.
          const text = (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('')
          return {
            content,
            functionCalls: res.functionCalls ?? [],
            text,
            usage: { prompt: u?.promptTokenCount ?? 0, output: u?.candidatesTokenCount ?? 0, thoughts: u?.thoughtsTokenCount ?? 0 },
            latencyMs: Date.now() - started,
            model: res.modelVersion ?? MODEL_ID,
          }
        } catch (e) {
          const status = statusOf(e)
          if (attempt < 2 && status && RETRYABLE.has(status) && !signal?.aborted) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
            continue
          }
          throw e instanceof LLMError ? e : new LLMError(String((e as Error)?.message ?? e).slice(0, 300), status)
        }
      }
    },
  }
}
