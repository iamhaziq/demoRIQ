import data from '../data'
import { money } from '../format'
import DecisionCard from '../components/DecisionCard'

export default function Today({ cardProps }) {
  const { kpis, cards, meta } = data
  return (
    <div className="page">
      <h1>Good morning</h1>
      <p className="lede">Here is what your stock is doing to your cash.</p>

      <div className="kpis">
        <div className="kpi">
          <div className="lab">Stock value</div>
          <div className="val">{money(kpis.inventory_value)}</div>
        </div>
        <div className="kpi">
          <div className="lab">Carrying cost per month</div>
          <div className="val">{money(kpis.carrying_cost_per_month)}</div>
        </div>
        <div className="kpi hero">
          <div className="lab">Cash trapped in slow stock</div>
          <div className="val">{money(kpis.cash_trapped)}</div>
          <div className="sub">{kpis.slow_sku_count} slow-moving products, valued at cost</div>
        </div>
      </div>

      <h2 className="section-h">{cards.length} decisions need you today</h2>
      <div className="cards">
        {cards.map((c) => (
          <DecisionCard key={c.id} card={c} {...cardProps(c.id)} />
        ))}
      </div>

      <p className="foot-note">{meta.disclaimer}</p>
    </div>
  )
}
