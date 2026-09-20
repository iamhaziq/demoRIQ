import data from '../data'

const NAV = [
  ['today', 'Today'],
  ['forecast', 'Forecast'],
  ['cost', 'Stock Cost'],
]

export function Rail({ view, onView }) {
  return (
    <aside className="rail">
      <div className="brand">
        <b>RetailIQ</b>
        <span>Prototype</span>
      </div>
      <nav className="nav">
        {NAV.map(([id, label]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => onView(id)}>
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

export function TopBar() {
  return (
    <header className="topbar">
      <div className="shop">
        Demo store {data.meta.store}
        <small>as of {data.meta.as_of}</small>
      </div>
      <div className="badge-demo" tabIndex={0}>
        Demo data: Walmart M5 benchmark · Stock levels simulated
        <span className="tip">{data.meta.disclaimer}</span>
      </div>
    </header>
  )
}
