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
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
