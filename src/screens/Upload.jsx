import { ACCEPT, FIELD_LABELS, fieldsFor, healthLines, jobView, mapProblems } from '../lib/upload'
import { useUpload } from '../lib/useUpload'

const KINDS = [
  ['sales', 'Sales', 'Units sold per day or per receipt', '/templates/sales_template.xlsx'],
  ['stock', 'Stock count', 'What is on the shelf now, with cost per unit', '/templates/stock_template.xlsx'],
]

const cell = (v) => (v === null || v === undefined ? '' : String(v))

function Health({ upload }) {
  const lines = healthLines(upload.health_json)
  const h = upload.health_json ?? {}
  return (
    <section className="panel">
      <h2>Data health</h2>
      <p className="sub">
        {upload.original_filename}: {upload.rows_ok} rows loaded
        {upload.rows_rejected > 0 && `, ${upload.rows_rejected} skipped`}
      </p>
      {lines.map((l) => (
        <div className="stat" key={l.label}>
          <span>{l.label}</span>
          <b>{l.value}</b>
        </div>
      ))}
      <p className={`health-note ${h.enough_history ? 'ok' : ''}`}>
        {h.enough_history
          ? 'Enough history for full forecasts.'
          : 'Under 90 days of sales: forecasts use simple averages until more history is uploaded. Products with under 8 weeks of sales are marked low confidence.'}
      </p>
    </section>
  )
}

function Rejected({ rows, total }) {
  if (!rows?.length) return null
  return (
    <section className="panel">
      <h2>Rows we skipped</h2>
      <p className="sub">Fix these in your file and upload it again; rows already loaded are not duplicated.</p>
      <ul className="rejected">
        {rows.map((r) => (
          <li key={`${r.row}-${r.reason}`}>
            <b>Row {r.row}</b> {r.reason}
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="sub">…and {total - rows.length} more.</p>}
    </section>
  )
}

function Job({ job }) {
  const v = jobView(job)
  return (
    <section className={`panel job ${v.phase}`} aria-live="polite">
      <h2>Preparing your forecasts</h2>
      <p className="job-line">
        {(v.phase === 'queued' || v.phase === 'running') && <span className="spinner" />}
        {v.text}
      </p>
      {v.detail && <p className="sub">Reason: {v.detail}</p>}
    </section>
  )
}

function Mapping({ u }) {
  const { required, optional } = fieldsFor(u.kind)
  const problems = mapProblems(u.columnMap, u.kind, u.preview.headers)
  const select = (f, req) => (
    <label className="map-row" key={f}>
      <span>
        {FIELD_LABELS[f]}
        {req && <em> required</em>}
      </span>
      <select value={u.columnMap[f] ?? ''} onChange={(e) => u.setColumnMap({ ...u.columnMap, [f]: e.target.value || undefined })}>
        <option value="">{req ? 'Choose a column…' : 'Not in my file'}</option>
        {u.preview.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  )
  const mapped = new Set(Object.values(u.columnMap).filter(Boolean))
  return (
    <>
      <section className="panel">
        <h2>Check the columns</h2>
        <p className="sub">
          {u.file.name}: {u.preview.totalRows} rows. We guessed which column is which; change any that are wrong.
        </p>
        <div className="map-grid">
          {required.map((f) => select(f, true))}
          {optional.map((f) => select(f, false))}
        </div>
        {(problems.length > 0 || u.error) && (
          <div className="state-box error" role="alert">
            {u.error && <b>{u.error.message}</b>}
            {[...(u.error?.details ?? []), ...problems].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="btn primary" disabled={problems.length > 0 || u.step === 'sending'} onClick={u.send}>
            {u.step === 'sending' ? 'Loading your file…' : 'Load this file'}
          </button>
          <button className="btn ghost" disabled={u.step === 'sending'} onClick={u.reset}>
            Choose another file
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>First {u.preview.rows.length} rows</h2>
        <div className="tablewrap preview">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                {u.preview.headers.map((h) => (
                  <th key={h} className={mapped.has(h) ? 'mapped' : ''}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {u.preview.rows.map((r, i) => (
                <tr key={i}>
                  <td>{u.preview.firstRow + i}</td>
                  {u.preview.headers.map((h) => (
                    <td key={h} className={mapped.has(h) ? '' : 'unused'}>{cell(r[h])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default function Upload({ shop }) {
  const u = useUpload(shop.id)

  return (
    <div className="page">
      <h1>Upload your data</h1>
      <p className="lede">Sales and stock files from your POS or a spreadsheet. RetailIQ checks every row before saving.</p>

      {u.step === 'pick' && (
        <section className="panel">
          <h2>1. What is in the file?</h2>
          <div className="kinds" role="radiogroup" aria-label="File type">
            {KINDS.map(([id, label, hint, template]) => (
              <label key={id} className={`kind ${u.kind === id ? 'on' : ''}`}>
                <input type="radio" name="kind" value={id} checked={u.kind === id} onChange={() => u.setKind(id)} />
                <b>{label}</b>
                <span>{hint}</span>
                <a href={template} download onClick={(e) => e.stopPropagation()}>
                  Download template
                </a>
              </label>
            ))}
          </div>
          <h2>2. Choose the file</h2>
          <input
            className="file"
            type="file"
            accept={ACCEPT}
            aria-label="File to upload"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = '' // so choosing the same file again still triggers a change
              if (f) u.choose(f)
            }}
          />
          <p className="sub">CSV or Excel, up to 20 MB. Dates as DD/MM/YYYY; prices in RM.</p>
          {u.error && (
            <div className="state-box error" role="alert">
              {u.error.message}
            </div>
          )}
        </section>
      )}

      {(u.step === 'map' || u.step === 'sending') && <Mapping u={u} />}

      {u.step === 'result' && (
        <section className="panel">
          <h2>File loaded</h2>
          <p className="sub">
            {u.result.rows_ok} rows saved{u.result.rows_rejected > 0 && `, ${u.result.rows_rejected} skipped (listed below)`}.
          </p>
          <div className="actions">
            <button className="btn primary" onClick={u.reset}>
              Upload another file
            </button>
          </div>
        </section>
      )}

      {u.step !== 'map' && u.step !== 'sending' && (
        <div className="upload-status">
          <Job job={u.job} />
          {u.last && <Health upload={u.last} />}
        </div>
      )}
      {u.step === 'result' && <Rejected rows={u.result.rejected} total={u.result.rows_rejected} />}
    </div>
  )
}
