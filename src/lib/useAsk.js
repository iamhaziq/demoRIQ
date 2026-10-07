import { useCallback, useRef, useState } from 'react'
import { supabase } from './supabase'
import { askAgent } from './ask.js'

/**
 * Ask box state. `ask` is null when the sheet is closed, otherwise
 * { query, phase: 'checking' | 'answer' | 'error', answer?, fallback?, error? }.
 * Only the latest question's reply is shown; replies to earlier or closed questions are dropped.
 */
export function useAsk() {
  const [ask, setAsk] = useState(null)
  const seq = useRef(0)

  const submit = useCallback((text) => {
    const query = String(text ?? '').trim()
    if (!query) return
    const id = ++seq.current
    setAsk({ query, phase: 'checking' })
    askAgent(supabase, query)
      .then((r) => id === seq.current && setAsk({ query, phase: 'answer', answer: r.answer, fallback: r.fallback }))
      .catch((error) => id === seq.current && setAsk({ query, phase: 'error', error }))
  }, [])

  const close = useCallback(() => {
    seq.current++
    setAsk(null)
  }, [])

  return { ask, submit, close }
}
