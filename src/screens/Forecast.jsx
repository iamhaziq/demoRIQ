import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, num, shortDate } from '../format'
import { useForecast } from '../lib/useForecast'

const NAVY = '#13223F'
const TEAL = '#0F766E'
const GRID = '#E6E3D8'
const MUTED = '#4A5568'

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="tt">
      <b>{shortDate(row.date)}</b>
      {row.units !== undefined ? (
        <>Sold: {num(row.units)} units</>
      ) : (
        <>
          Forecast (likely): {num(row.p50)} units
          <br />
          Range p10–p90: {num(row.p10)} to {num(row.p90)}
        </>
      )}
    </div>
  )
}

const units = (v) => (v === null ? '–' : `${num(v)} units`)
const days = (v) => (v === null ? '–' : `${num(v)} days`)

function Page({ children }) {
  return (
    <div className="page">
      <h1>Demand forecast</h1>
      {children}
    </div>
  )
}

export default function Forecast() {
  const { loading, error, products, productId, setProductId, detail, reload } = useForecast()

  if (loading) {
    return (
      <Page>
        <p className="lede state">Loading your products…</p>
      </Page>
    )
  }
  if (error || detail.error) {
    return (
      <Page>
        <div className="state-box error" role="alert">
          <b>We could not load the forecast.</b> {(error ?? detail.error).message}
          <button className="btn" onClick={reload}>Try again</button>
        </div>
      </Page>
    )
  }
  if (!products.length) {
    return (
      <Page>
        <div className="state-box">
          <b>Upload your sales and stock to see this.</b> RetailIQ forecasts the next 28 days for each product overnight
          after your first upload.
        </div>
      </Page>
    )
  }

  const d = detail.data
  const p = d?.panel
  const hasForecast = d && d.rows.some((r) => r.p50 !== undefined)

  return (
    <Page>
      <p className="lede">Next 28 days of demand, with a likely range, against what you have on the shelf.</p>

      <div className="toolbar">
        <label htmlFor="product">Product</label>
        <select id="product" value={productId ?? ''} onChange={(e) => setProductId(e.target.value)}>
          {products.map((x) => (
            <option key={x.id} value={x.id}>
              {x.sku ? `${x.sku} · ${x.name}` : x.name}
            </option>
          ))}
        </select>
        {detail.loading && <span className="state">Loading…</span>}
      </div>

      {d && (
        <div className="split">
          <section className="panel">
            <h2>{d.product?.name}</h2>
            {hasForecast ? (
              <>
                <p className="sub">Units sold per day. Last 120 days, then the next 28.</p>
                <ResponsiveContainer width="100%" height={430}>
                  <ComposedChart data={d.rows} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      interval={13}
                      tick={{ fill: MUTED, fontSize: 12.5 }}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                    />
                    <YAxis
                      allowDecimals
                      tick={{ fill: MUTED, fontSize: 12.5 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} />
                    {d.asOf && (
                      <ReferenceLine
                        x={d.asOf}
                        stroke={MUTED}
                        strokeDasharray="4 4"
                        label={{ value: 'last data', position: 'insideTopLeft', fill: MUTED, fontSize: 13 }}
                      />
                    )}
                    <Area dataKey="band" stroke="none" fill={TEAL} fillOpacity={0.2} activeDot={false} />
                    <Line
                      dataKey="units"
                      stroke={NAVY}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                    />
                    <Line
                      dataKey="p50"
                      stroke={TEAL}
                      strokeWidth={2.5}
                      strokeDasharray="6 5"
                      dot={false}
                      activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="key">
                  <span><i className="l" />Actual daily sales</span>
                  <span><i className="d" />Forecast (likely)</span>
                  <span><i className="b" />Likely range (p10–p90)</span>
                </div>
              </>
            ) : (
              <div className="state-box">
                <b>No forecast for this product yet.</b> It needs sales history, a stock count and a unit cost. The
                forecast appears the night after those are uploaded.
              </div>
            )}
          </section>

          <aside className="panel">
            <h2>Forecast and reorder</h2>
            <p className="sub">{d.product?.sku ?? ''}</p>
            <div className="stat"><span>Forecast, next 28 days (likely)</span><b>{units(p.p50)}</b></div>
            <div className="stat"><span>High case (p90)</span><b>{units(p.p90)}</b></div>
            <div className="stat"><span>Days of stock left</span><b>{days(p.daysOfCover)}</b></div>
            <div className="stat"><span>Supplier lead time</span><b>{days(p.leadTimeDays)}</b></div>
            <div className="stat">
              <span>Recommended order</span>
              <b>{p.orderQty === 0 ? 'None needed' : units(p.orderQty)}</b>
            </div>
            <div className="stat"><span>Cash required</span><b>{money(p.cashRequired)}</b></div>
            <div className="stat">
              <span>Confidence</span>
              {p.confidence ? <span className={`conf ${p.confidence}`}>{p.confidence}</span> : <b>–</b>}
            </div>
            <p className="method">
              {p.lowConfidence && 'Under 8 weeks of sales, so this uses the 28-day average. '}
              The shaded range is the model's daily low (p10) to high (p90) forecast.
              {p.source && ` Source: ${p.source}.`}
            </p>
          </aside>
        </div>
      )}
    </Page>
  )
}
