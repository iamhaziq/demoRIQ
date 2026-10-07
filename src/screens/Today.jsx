import { money } from '../format'
import { useToday } from '../lib/useToday'
import DecisionCard from '../components/DecisionCard'

function Tiles({ kpis }) {
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="lab">Stock value</div>
        <div className="val">{money(kpis.stock_value)}</div>
      </div>
      <div className="kpi">
        <div className="lab">Carrying cost per month</div>
        <div className="val">{money(kpis.carrying_cost_per_month)}</div>
      </div>
      <div className="kpi hero">
        <div className="lab">Cash trapped in slow stock</div>
        <div className="val">{money(kpis.cash_trapped)}</div>
        <div className="sub">{kpis.slow_products} slow-moving products, valued at cost</div>
      </div>
    </div>
  )
}

export default function Today({ shop, onUpload }) {
  const { loading, error, kpis, cards, status, feedback, feedbackError, reload } = useToday(shop.id)

  if (loading && !kpis && !cards.length) {
    return (
      <div className="page">
        <h1>Good morning</h1>
        <p className="lede state">Loading your shop…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="page">
        <h1>Good morning</h1>
        <div className="state-box error" role="alert">
          <b>We could not load today's numbers.</b> {error.message}
          <button className="btn" onClick={reload}>Try again</button>
        </div>
      </div>
    )
  }
  if (!kpis) {
    return (
      <div className="page">
        <h1>Good morning</h1>
        <div className="state-box">
          <b>Upload your sales and stock to see this.</b> Once your data is in, RetailIQ forecasts demand overnight and
          shows here what your stock is costing you and what to do about it.
          <button className="btn primary" onClick={onUpload}>Upload your data</button>
        </div>
      </div>
    )
  }

  const open = cards.filter((c) => !status[c.id])
  return (
    <div className="page">
      <h1>Good morning</h1>
      <p className="lede">Here is what your stock is doing to your cash.</p>
      <Tiles kpis={kpis} />

      <h2 className="section-h">
        {open.length === 0 ? 'No decisions need you today' : `${open.length} decision${open.length > 1 ? 's' : ''} need you today`}
      </h2>
      {feedbackError && (
        <p className="state-box error" role="alert">
          Your answer was not saved: {feedbackError}
        </p>
      )}
      <div className="cards">
        {cards.map((c) => (
          <DecisionCard
            key={c.id}
            card={c}
            status={status[c.id]}
            onApprove={() => feedback(c.id, 'done')}
            onDismiss={() => feedback(c.id, 'not_now')}
            onWrong={() => feedback(c.id, 'wrong')}
            onUndo={() => feedback(c.id, 'undo')}
          />
        ))}
      </div>

      <p className="foot-note">Numbers as of {kpis.as_of}, from your uploaded sales and stock. Each card shows its source.</p>
    </div>
  )
}
