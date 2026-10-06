import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadForecastProducts, loadProductForecast } from './forecastData.js'

/**
 * Forecast screen data. `products` loads once; `detail` follows the selected product.
 * A reply for a product that is no longer selected is ignored.
 */
export function useForecast() {
  const [list, setList] = useState({ loading: true, error: null, products: [] })
  const [productId, setProductId] = useState(null)
  const [detail, setDetail] = useState({ loading: true, error: null, data: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    loadForecastProducts(supabase)
      .then((r) => {
        if (!alive) return
        setList({ loading: false, error: null, products: r.products })
        setProductId((id) => id ?? r.defaultId)
        if (!r.defaultId) setDetail({ loading: false, error: null, data: null })
      })
      .catch((error) => alive && setList({ loading: false, error, products: [] }))
    return () => {
      alive = false
    }
  }, [attempt])

  useEffect(() => {
    if (!productId) return
    let alive = true
    loadProductForecast(supabase, productId)
      .then((data) => alive && setDetail({ loading: false, error: null, data }))
      .catch((error) => alive && setDetail({ loading: false, error, data: null }))
    return () => {
      alive = false
    }
  }, [productId, attempt])

  const select = useCallback((id) => {
    setDetail((d) => ({ ...d, loading: true, error: null }))
    setProductId(id)
  }, [])

  const reload = useCallback(() => {
    setList((l) => ({ ...l, loading: true, error: null }))
    setDetail((d) => ({ ...d, loading: true, error: null }))
    setAttempt((a) => a + 1)
  }, [])

  return { ...list, productId, setProductId: select, detail, reload }
}
