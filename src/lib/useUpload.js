import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { checkFile, latestJob, latestUpload, newerJob, previewFile, sendUpload, watchJobs } from './upload.js'

/**
 * Upload screen state.
 * step: 'pick' (choose kind + file) | 'map' (confirm columns) | 'sending' | 'result'.
 * `last` is the latest finished upload (health card); `job` is the latest ML job, kept live.
 */
export function useUpload(shopId) {
  const [kind, setKind] = useState('sales')
  const [step, setStep] = useState('pick')
  const [file, setFile] = useState(null) // { name, type, bytes }
  const [preview, setPreview] = useState(null)
  const [columnMap, setColumnMap] = useState({})
  const [error, setError] = useState(null) // { message, details }
  const [result, setResult] = useState(null)
  const [last, setLast] = useState(null)
  const [job, setJob] = useState(null)

  useEffect(() => {
    let alive = true
    const stop = watchJobs(supabase, shopId, (j) => alive && setJob((cur) => newerJob(cur, j)))
    Promise.all([latestUpload(supabase), latestJob(supabase)])
      .then(([u, j]) => {
        if (!alive) return
        setLast(u)
        setJob((cur) => newerJob(j, cur))
      })
      .catch(() => {}) // the screen still works without the history
    return () => {
      alive = false
      stop()
    }
  }, [shopId])

  const choose = useCallback(async (f) => {
    setError(null)
    const problem = checkFile(f)
    if (problem) return setError({ message: problem, details: [] })
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const XLSX = await import('xlsx')
      const p = previewFile(XLSX, bytes, f.name, kind)
      if (!p.headers.length || !p.totalRows) {
        return setError({ message: 'This file has no rows to read. Check that it is the right file.', details: [] })
      }
      setFile({ name: f.name, type: f.type, bytes })
      setPreview(p)
      setColumnMap(p.columnMap)
      setStep('map')
    } catch (e) {
      setError({ message: `This file could not be read: ${e.message}`, details: [] })
    }
  }, [kind])

  const send = useCallback(async () => {
    setError(null)
    setStep('sending')
    try {
      const r = await sendUpload(supabase, shopId, kind, file, columnMap)
      setResult(r)
      setLast({ kind, original_filename: file.name, rows_ok: r.rows_ok, rows_rejected: r.rows_rejected, health_json: r.health })
      setStep('result')
    } catch (e) {
      setError({ message: e.message, details: e.details ?? [] })
      setStep('map')
    }
  }, [shopId, kind, file, columnMap])

  const reset = useCallback(() => {
    setStep('pick')
    setFile(null)
    setPreview(null)
    setColumnMap({})
    setResult(null)
    setError(null)
  }, [])

  return {
    kind, setKind, step, file, preview, columnMap, setColumnMap, error, result, last, job, choose, send, reset,
  }
}
