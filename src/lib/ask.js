// Ask box: send a question to the agent-ask Edge Function. Plain module with the client passed in,
// so tests can run it too. The answer text is shown as returned; the frontend never reformats its numbers.

export const MAX_QUESTION = 500 // same limit as agent-ask

// Questions that work on any shop's data (no product names that may not exist in this shop).
export const SUGGESTED_QUESTIONS = [
  'What should I do today?',
  'Berapa kos stok perlahan saya?',
  'What should I order this week?',
  'How accurate is your forecast?',
]

/** Error shown to the owner. `retry` is false when asking again unchanged cannot help. */
export class AskError extends Error {
  constructor(message, retry = true) {
    super(message)
    this.retry = retry
  }
}

/** Trimmed question, or an AskError when it cannot be sent. */
export function cleanQuestion(text) {
  const q = String(text ?? '').trim()
  if (!q) throw new AskError('Type a question first.', false)
  if (q.length > MAX_QUESTION) throw new AskError(`Keep your question under ${MAX_QUESTION} characters.`, false)
  return q
}

/** Ask the agent. Resolves to { answer, language, fallback, tools }; rejects with AskError. */
export async function askAgent(supabase, text) {
  const question = cleanQuestion(text)
  const { data, error } = await supabase.functions.invoke('agent-ask', { body: { question } })
  if (error) throw await toAskError(error)
  if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
    throw new AskError('RetailIQ sent an empty answer. Please try again.')
  }
  return {
    answer: data.answer,
    language: data.language === 'ms' ? 'ms' : 'en',
    fallback: data.fallback === true,
    tools: Array.isArray(data.tools) ? data.tools : [],
  }
}

/** Map a functions.invoke error (HTTP, relay or network) to a message for the owner. */
async function toAskError(error) {
  const res = error.context
  if (res && typeof res.status === 'number') {
    let detail = ''
    try {
      detail = (await res.clone().json())?.error ?? ''
    } catch {
      // body was not JSON
    }
    if (res.status === 401) return new AskError('Your session has ended. Sign in again to ask.', false)
    if (res.status === 403) return new AskError('This account has no shop yet.', false)
    if (res.status === 400) return new AskError(detail || 'That question could not be sent.', false)
    return new AskError('RetailIQ could not answer just now. Please try again.')
  }
  return new AskError('Could not reach RetailIQ. Check your connection and try again.')
}

/** Answer text for display: Markdown bold markers and extra blank lines go; words and numbers stay as sent. */
export function displayAnswer(answer) {
  return String(answer ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
