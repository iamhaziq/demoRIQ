import { useCallback, useEffect, useRef, useState } from 'react'
import { cardById, matchQuestion, productsByCost } from './data'
import { Rail, TopBar } from './components/Shell'
import AskBar from './components/AskBar'
import AgentOverlay from './components/AgentOverlay'
import Today from './screens/Today'
import Forecast from './screens/Forecast'
import StockCost from './screens/StockCost'

const CHECKING_MS = 1200
const REORDER_SKU = cardById.reorder.sku
const TOP_COST_SKU = productsByCost[0].sku

export default function App({ shop, onSignOut }) {
  const [view, setView] = useState('today')
  const [ask, setAsk] = useState('')
  const [overlay, setOverlay] = useState(null) // { query, phase, card }
  const [status, setStatus] = useState({}) // cardId -> 'approved' | 'dismissed'
  const [costSku, setCostSku] = useState(TOP_COST_SKU)
  const [forecastSku, setForecastSku] = useState(REORDER_SKU)
  const [promoOpen, setPromo] = useState(false)
  const timer = useRef(null)

  const closeOverlay = useCallback(() => {
    clearTimeout(timer.current)
    setOverlay(null)
  }, [])

  const submit = useCallback((text) => {
    const query = text.trim()
    if (!query) return
    setAsk(query)
    clearTimeout(timer.current)
    setOverlay({ query, phase: 'checking', card: null })
    timer.current = setTimeout(() => {
      const card = matchQuestion(query)
      setOverlay({ query, phase: card ? 'answer' : 'nomatch', card })
    }, CHECKING_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const cardProps = (id) => ({
    status: status[id],
    onApprove: () => setStatus((s) => ({ ...s, [id]: 'approved' })),
    onDismiss: () => setStatus((s) => ({ ...s, [id]: 'dismissed' })),
    onUndo: () => setStatus((s) => ({ ...s, [id]: undefined })),
  })

  return (
    <div className="app">
      <Rail view={view} onView={setView} />
      <TopBar shop={shop} onSignOut={onSignOut} />
      <main className="main">
        {view === 'today' && <Today cardProps={cardProps} />}
        {view === 'forecast' && <Forecast sku={forecastSku} onSku={setForecastSku} />}
        {view === 'cost' && (
          <StockCost
            sku={costSku}
            onSku={setCostSku}
            suggestShown
            promoOpen={promoOpen}
            onPromo={() => setPromo((v) => !v)}
          />
        )}
      </main>
      {overlay && (
        <AgentOverlay
          query={overlay.query}
          phase={overlay.phase}
          card={overlay.card}
          cardProps={overlay.card ? cardProps(overlay.card.id) : {}}
          onClose={closeOverlay}
          onAsk={submit}
        />
      )}
      <AskBar value={ask} onChange={setAsk} onSubmit={submit} />
    </div>
  )
}
