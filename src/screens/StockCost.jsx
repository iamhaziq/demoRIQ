import { useState } from 'react'
import data, { productBySku, productsByCost } from '../data'
import { money, num } from '../format'

// Order matches the voiceover: financing, shelf space, handling, spoilage, profit forgone.
// `at` is when each one appears (seconds) in demo/stagger mode, timed to the narration.
const COMPONENTS = [
  ['financing', 'Financing', '#13223F', 3.5],
  ['space', 'Shelf space', '#0F766E', 4.9],
  ['service', 'Handling', '#7C8DB5', 5.9],
  ['risk', 'Spoilage risk', '#B45309', 7.0],
  ['opportunity', 'Profit forgone', '#8E6BBF', 9.1],
]
const TOTAL_AT = 12.5

function HoldOrClear({ p, suggestShown, promoOpen, onPromo }) {
  const rows = p.hold_or_clear.by_sell_through
  const start = Math.max(0, rows.findIndex((r) => r.sell_through === p.hold_or_clear.sell_through))
  const [i, setI] = useState(start)
  const r = rows[i]
  return (
    <div className="block">
      <h3>Hold or clear</h3>
      <div className="hint">If this share of your {num(p.stock)} units sells:</div>
      <input
        className="slider"
        type="range"
        min={0}
        max={rows.length - 1}
        step={1}
        value={i}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Sell-through"
      />
      <div className="ticks">
        <span>{Math.round(rows[0].sell_through * 100)}%</span>
        <b>{Math.round(r.sell_through * 100)}% sell</b>
        <span>{Math.round(rows[rows.length - 1].sell_through * 100)}%</span>
      </div>
      <div className="be">
        <span>Break-even discount</span>
        <b>{r.clear_at_any_discount ? '95%+' : `${r.break_even_discount_pct}%`}</b>
      </div>
      <p className="hint">
        Holding for {r.holding_days} days costs {money(r.holding_cost_per_unit)} per unit ({money(r.holding_cost_total)} in
        total). Any discount below the break-even beats holding.
      </p>

      {suggestShown && (
        <div className="suggest reveal">
          <span>
            The agent recommends: <b>start at {r.start_discount_pct}% off</b>
          </span>
          <button className="btn" onClick={onPromo}>
            {promoOpen ? 'Hide promo message' : 'Draft promo message'}
          </button>
        </div>
      )}
      {suggestShown && promoOpen && <div className="draft promo reveal">{p.promo_draft}</div>}

      <DebtFree r={r} />
    </div>
  )
}

function DebtFree({ r }) {
  return (
    <div className="debtfree" style={{ marginTop: 18 }}>
      <h3>Debt Freedom</h3>
      <div className="row">
        <div>
          <span>Cash released</span>
          <b>{money(r.cash_released)}</b>
        </div>
        <span className="arrow">→</span>
        <div>
          <span>Interest avoided</span>
          <b>{money(r.interest_avoided_per_year)} / year</b>
        </div>
      </div>
      <small>Financing rate: {data.meta.financing_label}</small>
    </div>
  )
}

function Detail({ p, ...hold }) {
  const c = p.cost_components
  return (
    <div className="detail panel">
      <div>
        <h2>
          {p.name}
          <span className={`tag ${p.slow_stock ? '' : 'ok'}`}>{p.slow_stock ? 'Slow stock' : 'Fast mover'}</span>
        </h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          {p.sku} · {num(p.stock)} units · {money(p.inventory_value)} at cost · {p.age_days} days old
        </p>
      </div>

      <div className="block">
        <h3>What holding it costs, per year: {money(p.carrying_cost_annual)}</h3>
        <div className="stack" role="img" aria-label="Carrying cost split">
          {COMPONENTS.map(([k, , color, at]) => (
            <div key={k} className="reveal stagger" style={{ flexGrow: c[k], background: color, '--d': `${at}s` }} />
          ))}
        </div>
        <div className="comp">
          {COMPONENTS.map(([k, label, color, at]) => (
            <div key={k} className="reveal stagger" style={{ '--d': `${at}s` }}>
              <i style={{ background: color }} />
              <span>
                {label}
                <b>{money(c[k])}</b>
              </span>
            </div>
          ))}
        </div>
        <div className="total reveal stagger" style={{ '--d': `${TOTAL_AT}s` }}>
          Together: <b>{p.carrying_rate_pct}</b> of the stock's value, every year
        </div>
      </div>

      <div className="block">
        <h3>Cost of holding it for…</h3>
        <div className="horizon">
          <div><span>1 day</span><b>{money(p.cost_per_day)}</b></div>
          <div><span>30 days</span><b>{money(p.cost_30d)}</b></div>
          <div><span>180 days</span><b>{money(p.cost_180d)}</b></div>
          <div><span>365 days</span><b>{money(p.cost_365d)}</b></div>
        </div>
      </div>

      {p.slow_stock ? (
        <HoldOrClear key={p.sku} p={p} {...hold} />
      ) : (
        <p className="hint">
          This product is selling: {p.days_of_cover_text} of stock left. Clearing it is not recommended. See the Forecast
          screen for reordering.
        </p>
      )}
    </div>
  )
}

export default function StockCost({ sku, onSku, ...hold }) {
  const p = productBySku[sku]
  return (
    <div className="page">
      <h1>True cost of stock</h1>
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
              {productsByCost.map((x) => (
                <tr key={x.sku} className={x.sku === sku ? 'sel' : ''} onClick={() => onSku(x.sku)}>
                  <td>
                    {x.slow_stock && <span className="warn">⚠ </span>}
                    {x.name}
                    <span className="sku">{x.sku}</span>
                  </td>
                  <td>{num(x.stock)}</td>
                  <td>{money(x.inventory_value)}</td>
                  <td>{x.age_days} d</td>
                  <td>{x.days_of_cover_text}</td>
                  <td className="cd">{money(x.cost_per_day)}</td>
                  <td>{money(x.cost_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Detail key={sku} p={p} {...hold} />
      </div>
    </div>
  )
}
