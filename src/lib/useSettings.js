import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { diffSettings, loadSettings, productForm, recalculate, saveSettings, shopForm } from './settings.js'
import { latestJob, newerJob, watchJobs } from './upload.js'

/** Settings screen: stored values, the edit form, save, and an optional forecast run with live status. */
export function useSettings(shopId, onShopChange) {
  const [stored, setStored] = useState(null) // { shop, products }
  const [form, setForm] = useState({})
  const [pform, setPform] = useState({})
  const [state, setState] = useState({ loading: true, error: null, saving: false, saved: false, errors: {} })
  const [attempt, setAttempt] = useState(0)
  const [job, setJob] = useState(null)
  const [runError, setRunError] = useState(null)

  useEffect(() => {
    let alive = true
    loadSettings(supabase)
      .then((d) => {
        if (!alive) return
        setStored(d)
        setForm(shopForm(d.shop))
        setPform(productForm(d.products))
        setState((s) => ({ ...s, loading: false, error: null }))
      })
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })))
    return () => {
      alive = false
    }
  }, [attempt])

  useEffect(() => {
    let alive = true
    const stop = watchJobs(supabase, shopId, (j) => alive && setJob((cur) => newerJob(cur, j)))
    latestJob(supabase).then((j) => alive && setJob((cur) => newerJob(j, cur))).catch(() => {})
    return () => {
      alive = false
      stop()
    }
  }, [shopId])

  const pending = stored ? diffSettings(stored.shop, form, stored.products, pform) : null
  const dirty = Boolean(pending && (Object.keys(pending.shopPatch).length || pending.productPatches.length))

  const edit = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setState((s) => ({ ...s, saved: false }))
  }, [])
  const editProduct = useCallback((id, key, value) => {
    setPform((f) => ({ ...f, [id]: { ...f[id], [key]: value } }))
    setState((s) => ({ ...s, saved: false }))
  }, [])

  const save = useCallback(async () => {
    const { shopPatch, productPatches, errors } = diffSettings(stored.shop, form, stored.products, pform)
    if (Object.keys(errors).length) return setState((s) => ({ ...s, errors, saved: false }))
    setState((s) => ({ ...s, saving: true, errors: {}, error: null }))
    try {
      await saveSettings(supabase, shopId, shopPatch, productPatches)
      const shop = { ...stored.shop, ...shopPatch }
      const patched = new Map(productPatches.map((p) => [p.id, p.patch]))
      setStored({ shop, products: stored.products.map((p) => ({ ...p, ...patched.get(p.id) })) })
      if (shopPatch.name || shopPatch.language) onShopChange?.({ name: shop.name, language: shop.language })
      setState((s) => ({ ...s, saving: false, saved: true }))
    } catch (error) {
      setState((s) => ({ ...s, saving: false, error }))
    }
  }, [stored, form, pform, shopId, onShopChange])

  const run = useCallback(async () => {
    setRunError(null)
    try {
      await recalculate(supabase)
    } catch (e) {
      setRunError(e.message)
    }
  }, [])

  return {
    ...state, stored, form, pform, dirty, edit, editProduct, save, run, job, runError,
    reload: () => setAttempt((a) => a + 1),
  }
}
