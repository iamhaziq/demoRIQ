import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import data, { productBySku } from '../data'
import { money, num, shortDate } from '../format'

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

export default function Forecast({ sku, onSku }) {
  const p = productBySku[sku]
  const rows = [...data.history[sku], ...data.forecast_daily[sku]]
  const f = p.forecast_28d
  const r = p.reorder

  return (
    <div className="page">
      <h1>Demand forecast</h1>
      <p className="lede">Next 28 days of demand, with a likely range, against what you have on the shelf.</p>

      <div className="toolbar">
        <label htmlFor="sku">Product</label>
        <select id="sku" value={sku} onChange={(e) => onSku(e.target.value)}>
          {data.products.map((x) => (
            <option key={x.sku} value={x.sku}>
              {x.sku} · {x.name}
            </option>
          ))}
        </select>
      </div>

      <div className="split">
        <section className="panel">
          <h2>{p.name}</h2>
          <p className="sub">Units sold per day. Last 120 days, then the next 28.</p>
          <ResponsiveContainer width="100%" height={430}>
            <ComposedChart data={rows} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
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
              <ReferenceLine
                x={data.meta.as_of}
                stroke={MUTED}
                strokeDasharray="4 4"
                label={{ value: 'today', position: 'insideTopLeft', fill: MUTED, fontSize: 13 }}
              />
              <Area
                dataKey="band"
                stroke="none"
                fill={TEAL}
                fillOpacity={0.2}
                animationBegin={1800}
                animationDuration={900}
                activeDot={false}
              />
              <Line
                dataKey="units"
                stroke={NAVY}
                strokeWidth={2}
                dot={false}
                animationDuration={1800}
                activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
              />
              <Line
                dataKey="p50"
                stroke={TEAL}
                strokeWidth={2.5}
                strokeDasharray="6 5"
                dot={false}
                animationBegin={1800}
                animationDuration={900}
                activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="key">
            <span><i className="l" />Actual daily sales</span>
            <span><i className="d" />Forecast (likely)</span>
            <span><i className="b" />Likely range (p10–p90)</span>
          </div>
        </section>

        <aside className="panel">
          <h2>Forecast and reorder</h2>
          <p className="sub">{p.sku}</p>
          <div className="stat"><span>Forecast, next 28 days (likely)</span><b>{num(f.p50)} units</b></div>
          <div className="stat"><span>High case (p90)</span><b>{num(f.p90)} units</b></div>
          <div className="stat"><span>Days of stock left</span><b>{p.days_of_cover_text}</b></div>
          <div className="stat"><span>Supplier lead time</span><b>{p.lead_time_days} days</b></div>
          <div className="stat">
            <span>Recommended order</span>
            <b>{r.recommended_qty > 0 ? `${num(r.recommended_qty)} units` : 'None needed'}</b>
          </div>
          <div className="stat"><span>Cash required</span><b>{money(r.cash_required)}</b></div>
          <div className="stat">
            <span>Confidence</span>
            <span className={`conf ${p.forecast_confidence}`}>{p.forecast_confidence}</span>
          </div>
          <p className="method">
            {data.meta.forecast_method_label}. The shaded range spreads the 28-day p10–p90 total across
            days using the recent weekly pattern.
          </p>
        </aside>
      </div>
    </div>
  )
}
