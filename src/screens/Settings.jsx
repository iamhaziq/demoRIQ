import { useEffect } from 'react'
import { PRODUCT_FIELDS, SHOP_FIELDS } from '../lib/settings'
import { jobView } from '../lib/upload'
import { useSettings } from '../lib/useSettings'

function Field({ f, value, error, onChange }) {
  const id = `s-${f.key}`
  let input
  if (f.kind === 'bool') {
    input = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  } else if (f.kind === 'lang') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="ms">Bahasa Melayu</option>
        <option value="en">English</option>
      </select>
    )
  } else {
    input = (
      <input id={id} type="text" inputMode={f.kind === 'text' ? 'text' : 'decimal'} value={value}
        aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} />
    )
  }
  return (
    <div className={`set-row ${f.kind === 'bool' ? 'check' : ''}`}>
      <label htmlFor={id}>{f.label}</label>
      {input}
      {f.help && <small>{f.help}</small>}
      {error && <small className="err">{error}</small>}
    </div>
  )
}

const GROUPS = [
  ['shop', 'Your shop', null],
  ['money', 'Money', 'These set what holding stock costs you (True Cost).'],
  ['advanced', 'Advanced', 'Starting values are the prototype defaults (opportunity 15%, handling 3%, spoilage 12%, 60-day window). Change them if you know your own figures.'],
]

function Run({ s }) {
  const v = jobView(s.job)
  const busy = v.phase === 'queued' || v.phase === 'running'
  return (
    <div className="set-run">
      <div>
        <b>Changes apply from the next forecast run</b> (every night at 2 am).
        {s.job && (
          <p className={`job-line ${v.phase}`}>
            {busy && <span className="spinner" />}
            {v.text}
          </p>
        )}
        {s.runError && <p className="err">{s.runError}</p>}
      </div>
      <button className="btn" disabled={busy || s.dirty} onClick={s.run} title={s.dirty ? 'Save first' : ''}>
        Recalculate now
      </button>
    </div>
  )
}

export default function Settings({ shop, onShopChange }) {
  const s = useSettings(shop.id, onShopChange)

  // After a failed save, take the owner to the first value that needs fixing.
  useEffect(() => {
    if (Object.keys(s.errors).length) document.querySelector('.settings [aria-invalid=true]')?.focus()
  }, [s.errors])

  if (s.loading) {
    return (
      <div className="page">
        <h1>Settings</h1>
        <p className="lede state">Loading your settings…</p>
      </div>
    )
  }
  if (!s.stored) {
    return (
      <div className="page">
        <h1>Settings</h1>
        <div className="state-box error" role="alert">
          <b>We could not load your settings.</b> {s.error?.message}
          <button className="btn" onClick={s.reload}>Try again</button>
        </div>
      </div>
    )
  }

  const nErrors = Object.keys(s.errors).length
  return (
    <div className="page settings">
      <h1>Settings</h1>
      <p className="lede">Your costs and suppliers. RetailIQ uses these to work out what stock costs you and when to reorder.</p>

      {GROUPS.map(([g, title, sub]) => (
        <section className="panel" key={g}>
          <h2>{title}</h2>
          {sub && <p className="sub">{sub}</p>}
          <div className="set-grid">
            {SHOP_FIELDS.filter((f) => f.group === g).map((f) => (
              <Field key={f.key} f={f} value={s.form[f.key]} error={s.errors[`shop.${f.key}`]} onChange={(v) => s.edit(f.key, v)} />
            ))}
          </div>
        </section>
      ))}

      <section className="panel">
        <h2>Products</h2>
        {s.stored.products.length === 0 ? (
          <p className="sub">Products appear here after your first upload.</p>
        ) : (
          <>
            <p className="sub">Leave the selling window blank to use the shop's. Shelf space per unit: 1 for small items, about 6 for large ones.</p>
            <div className="tablewrap">
              <table className="set-products">
                <thead>
                  <tr>
                    <th>Product</th>
                    {PRODUCT_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {s.stored.products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        {p.sku && <span className="sku">{p.sku}</span>}
                      </td>
                      {PRODUCT_FIELDS.map((f) => {
                        const err = s.errors[`${p.id}.${f.key}`]
                        return (
                          <td key={f.key}>
                            <input type="text" inputMode="decimal" aria-label={`${p.name}: ${f.label}`} aria-invalid={Boolean(err)}
                              value={s.pform[p.id]?.[f.key] ?? ''} placeholder={f.blank ?? ''}
                              onChange={(e) => s.editProduct(p.id, f.key, e.target.value)} />
                            {err && <small className="err">{err}</small>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="set-actions">
        <button className="btn primary" disabled={!s.dirty || s.saving} onClick={s.save}>
          {s.saving ? 'Saving…' : 'Save changes'}
        </button>
        {s.saved && !s.dirty && <span className="ok">Saved.</span>}
        {nErrors > 0 && <span className="err" role="alert">Fix the {nErrors === 1 ? 'highlighted value' : `${nErrors} highlighted values`}.</span>}
        {s.error && <span className="err" role="alert">Not saved: {s.error.message}</span>}
      </div>

      <Run s={s} />
    </div>
  )
}
