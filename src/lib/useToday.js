import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadToday, saveFeedback } from './todayData.js'

/** Today screen data: KPI tiles, decision cards, and each card's feedback status. */
export function useToday(shopId) {
  const [state, setState] = useState({ loading: true, error: null, kpis: null, cards: [], status: {} })

  const fetchInto = useCallback((isAlive = () => true) => {
    loadToday(supabase)
      .then((d) => isAlive() && setState({ loading: false, error: null, ...d }))
      .catch((error) => isAlive() && setState((s) => ({ ...s, loading: false, error })))
  }, [])

  // First load: state already starts as loading. Results after unmount are ignored.
  useEffect(() => {
    let alive = true
    fetchInto(() => alive)
    return () => {
      alive = false
    }
  }, [fetchInto])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchInto()
  }, [fetchInto])

  /** Record feedback (append-only). Optimistic; reverts and reports if the write fails. */
  const feedback = useCallback(async (decisionId, action) => {
    const next = { done: 'approved', not_now: 'dismissed', wrong: 'wrong', undo: undefined }[action]
    let before
    setState((s) => {
      before = s.status[decisionId]
      return { ...s, status: { ...s.status, [decisionId]: next }, feedbackError: null }
    })
    const error = await saveFeedback(supabase, shopId, decisionId, action)
    if (error) {
      setState((s) => ({ ...s, status: { ...s.status, [decisionId]: before }, feedbackError: error.message }))
    }
  }, [shopId])

  return { ...state, reload, feedback }
}
