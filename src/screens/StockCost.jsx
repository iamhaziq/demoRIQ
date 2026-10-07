import { useState } from 'react'
import { money, num, pct } from '../format'
import { useStockCost } from '../lib/useStockCost'

const COMPONENTS = [
  ['financing', 'Financing', '#13223F'],
  ['space', 'Shelf space', '#0F766E'],
  ['service', 'Handling', '#7C8DB5'],
  ['risk', 'Spoilage risk', '#B45309'],
  ['opportunity', 'Profit forgone', '#8E6BBF'],
]

const days = (v) => (v === null ? '–' : `${num(v)} days`)

function HoldOrClear({ h }) {
  const [i, setI] = useState(h.start)
  const [promoOpen, setPromo] = useState(false)
  const r = h.rows[i]
  const first = h.rows[0]
  const last = h.rows[h.rows.length - 1]
  return (
    <div className="block">
      <h3>Hold or clear</h3>
      <div className="hint">If this share of your {num(h.units)} units sells:</div>
      <input
        className="slider"
        type="range"
        min={0}
        max={h.rows.length - 1}
        step={1}
        value={i}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Sell-through"
      />
      <div className="ticks">
        <span>{pct(first.sellThrough)}</span>
        <b>{pct(r.sellThrough)} sell</b>
        <span>{pct(last.sellThrough)}</span>
      </div>
      <div className="be">
        <span>Break-even discount</span>
        <b>{r.clearAtAnyDiscount ? 'Any discount' : r.breakEvenPct === null ? '–' : `${num(r.breakEvenPct)}%`}</b>
      </div>
      <p className="hint">
        Holding for {days(h.holdingDays)} costs {money(h.holdingCostPerUnit)} per unit ({money(h.holdingCostTotal)} in
        total). Any discount below the break-even beats holding.
      </p>

      {r.discountPct !== null ? (
        <>
          <div className="suggest">
            <span>
              RetailIQ recommends: <b>start at {num(r.discountPct)}% off</b>
            </span>
            <button className="btn" onClick={() => setPromo((v) => !v)}>
              {promoOpen ? 'Hide promo message' : 'Draft promo message'}
            </button>
          </div>
          {promoOpen && <div className="draft promo">{r.draft}</div>}
        </>
      ) : (
        <div className="suggest">
          <span>
            RetailIQ recommends: <b>hold for now</b>. No discount step is below the break-even.
          </span>
        </div>
      )}

      <div className="debtfree" style={{ marginTop: 18 }}>
        <h3>Debt Freedom</h3>
        <div className="row">
          <div>
            <span>Cash released</span>
            <b>{money(r.cashReleased)}</b>
          </div>
          <span className="arrow">→</span>
          <div>
            <span>Interest avoided</span>
            <b>{money(r.interestAvoided)} / year</b>
          </div>
        </div>
        <small>Financing rate: {pct(h.loanRate)} per year, from your settings when the numbers were run</small>
      </div>
    </div>
  )
}

function Detail({ row, d }) {
  const c = d.components
  return (
    <div className="detail panel">
      <div>
        <h2>
          {row.name}
          <span className={`tag ${row.slow ? '' : 'ok'}`}>{row.slow ? 'Slow stock' : 'Selling'}</span>
        </h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          {[row.sku, `${num(row.onHand)} units`, `${money(row.stockValue)} at cost`,
            row.ageDays === null ? null : `${num(row.ageDays)} days since last delivery`].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="block">
        <h3>What holding it costs, per year: {money(d.annualCost)}</h3>
        <div className="stack" role="img" aria-label="Carrying cost split">
          {COMPONENTS.map(([k, , color]) => (
            <div key={k} className="reveal" style={{ flexGrow: c[k] ?? 0, background: color }} />
          ))}
        </div>
        <div className="comp">
          {COMPONENTS.map(([k, label, color]) => (
            <div key={k} className="reveal">
              <i style={{ background: color }} />
              <span>
                {label}
                <b>{money(c[k])}</b>
              </span>
            </div>
          ))}
        </div>
        <div className="total reveal">
          Together: <b>{pct(d.carryingRate)}</b> of the stock's value, every year
        </div>
      </div>

      <div className="block">
        <h3>Cost of holding it for…</h3>
        <div className="horizon">
          <div><span>1 day</span><b>{money(d.horizon.day)}</b></div>
          <div><span>30 days</span><b>{money(d.horizon.d30)}</b></div>
          <div><span>180 days</span><b>{money(d.horizon.d180)}</b></div>
          <div><span>365 days</span><b>{money(d.horizon.d365)}</b></div>
        </div>
      </div>

      {d.hold ? (
        <HoldOrClear key={row.id} h={d.hold} />
      ) : (
        <p className="hint">
          This product is selling: {days(row.daysOfCover)} of stock left. Clearing it is not recommended. See the Forecast
          screen for reordering.
        </p>
      )}
    </div>
  )
}

function Page({ children }) {
  return (
    <div className="page">
      <h1>True cost of stock</h1>
      {children}
    </div>
  )
}

export default function StockCost() {
  const { loading, error, rows, details, reload } = useStockCost()
  const [picked, setPicked] = useState(null)

  if (loading && !rows.length) {
    return (
      <Page>
        <p className="lede state">Loading your stock…</p>
      </Page>
    )
  }
  if (error) {
    return (
      <Page>
        <div className="state-box error" role="alert">
          <b>We could not load your stock costs.</b> {error.message}
          <button className="btn" onClick={reload}>Try again</button>
        </div>
      </Page>
    )
  }
  if (!rows.length) {
    return (
      <Page>
        <div className="state-box">
          <b>Upload your sales and stock to see this.</b> RetailIQ works out what each product costs you to hold
          overnight after your first upload. Products need a stock count and a unit cost.
        </div>
      </Page>
    )
  }

  const id = details[picked] ? picked : rows[0].id
  const row = rows.find((r) => r.id === id)
  return (
    <Page>
      <p className="lede">What every product costs you each day it sits on the shelf.</p>

      <div className="cost-split">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Stock</th>
                <th>Value</th>
                <th>Age</th>
                <th>Days of cover</th>
                <th>Cost / day</th>
                <th>Cost / month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className={x.id === id ? 'sel' : ''} onClick={() => setPicked(x.id)}>
                  <td>
                    {x.slow && <span className="warn">⚠ </span>}
                    {x.name}
                    {x.sku && <span className="sku">{x.sku}</span>}
                  </td>
                  <td>{num(x.onHand)}</td>
                  <td>{money(x.stockValue)}</td>
                  <td>{x.ageDays === null ? '–' : `${num(x.ageDays)} d`}</td>
                  <td>{num(x.daysOfCover)}</td>
                  <td className="cd">{money(x.costPerDay)}</td>
                  <td>{money(x.cost30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Detail key={id} row={row} d={details[id]} />
      </div>
    </Page>
  )
}
