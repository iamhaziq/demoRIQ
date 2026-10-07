import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/** The signed-in session: undefined while loading, null when signed out. */
export function useSession() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  return session
}

/** The signed-in owner's shop (created automatically on first sign-in). */
export function useShop(session) {
  const [state, setState] = useState({ shop: null, loading: true, error: null })
  useEffect(() => {
    if (!session) return undefined
    let alive = true
    supabase
      .from('shops')
      .select('id, name, language')
      .maybeSingle()
      .then(({ data, error }) => alive && setState({ shop: data, loading: false, error }))
    return () => {
      alive = false
    }
  }, [session])
  /** Merge saved changes (name, language) without reloading. */
  const update = useCallback((patch) => setState((s) => ({ ...s, shop: s.shop && { ...s.shop, ...patch } })), [])
  return { ...state, update }
}
