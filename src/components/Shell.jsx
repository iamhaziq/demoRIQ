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
        <span>Pilot</span>
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

export function TopBar({ shop, onSignOut }) {
  return (
    <header className="topbar">
      <div className="shop">{shop.name}</div>
      <div className="topbar-right">
        {/* Shown until every screen reads Supabase (docs/frontend.md). */}
        <div className="badge-demo" tabIndex={0}>
          Sample numbers
          <span className="tip">{data.meta.disclaimer} Your own figures appear here as each screen is connected.</span>
        </div>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
