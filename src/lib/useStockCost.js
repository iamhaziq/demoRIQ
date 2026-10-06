import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadStockCost } from './stockCostData.js'

/** Stock Cost screen data: the cost table and each product's breakdown, loaded together. */
export function useStockCost() {
  const [state, setState] = useState({ loading: true, error: null, asOf: null, rows: [], details: {} })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    loadStockCost(supabase)
      .then((d) => alive && setState({ loading: false, error: null, ...d }))
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })))
    return () => {
      alive = false
    }
  }, [attempt])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    setAttempt((a) => a + 1)
  }, [])

  return { ...state, reload }
}
