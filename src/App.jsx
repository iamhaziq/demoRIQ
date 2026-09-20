import { useCallback, useEffect, useRef, useState } from 'react'
import data, { cardById, matchQuestion, productsByCost } from './data'
import { Rail, TopBar } from './components/Shell'
import AskBar from './components/AskBar'
import AgentOverlay from './components/AgentOverlay'
import Today from './screens/Today'
import Forecast from './screens/Forecast'
import StockCost from './screens/StockCost'
import { useDemo } from './demo'

const CHECKING_MS = 1200
const REORDER_SKU = cardById.reorder.sku
const TOP_COST_SKU = productsByCost[0].sku

// Where the camera should look for each demo spotlight (CSS in index.css does the emphasis).
const SPOT_TARGET = {
  cash: '.kpi.hero',
  footer: '.sheet .src',
  breakeven: '.be',
  suggest: '.suggest',
  promo: '.promo',
  debt: '.debtfree',
  reorder: '.card.c-REORDER',
}

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const demo = params.get('demo') === '1'
  const shot = Number(params.get('shot')) || 0

  const [view, setView] = useState('today')
  const [ask, setAsk] = useState('')
  const [overlay, setOverlay] = useState(null) // { query, phase, card }
  const [status, setStatus] = useState({}) // cardId -> 'approved' | 'dismissed'
  const [costSku, setCostSku] = useState(TOP_COST_SKU)
  const [forecastSku, setForecastSku] = useState(REORDER_SKU)
  const [suggestShown, setSuggest] = useState(true)
  const [promoOpen, setPromo] = useState(false)
  const [spot, setSpot] = useState(null)
  const [booted, setBooted] = useState(true)
  const [stagger, setStagger] = useState(false)
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

  // Bring the spotlighted element to the middle of the screen.
  useEffect(() => {
    if (!spot) return undefined
    const t = setTimeout(() => {
      document.querySelector(SPOT_TARGET[spot])?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => clearTimeout(t)
  }, [spot, view])

  const cardProps = (id) => ({
    status: status[id],
    onApprove: () => setStatus((s) => ({ ...s, [id]: 'approved' })),
    onDismiss: () => setStatus((s) => ({ ...s, [id]: 'dismissed' })),
    onUndo: () => setStatus((s) => ({ ...s, [id]: undefined })),
  })

  useDemo(demo, shot, {
    question: data.malay_questions[0].text,
    topCostSku: TOP_COST_SKU,
    reorderSku: REORDER_SKU,
    reset: () => {
      closeOverlay()
      setAsk('')
      setStatus({})
      setView('today')
      setCostSku(TOP_COST_SKU)
      setForecastSku(REORDER_SKU)
      setSuggest(true)
      setPromo(false)
      setSpot(null)
      setBooted(true)
      setStagger(false)
      document.querySelector('.main')?.scrollTo({ top: 0 })
    },
    setAsk,
    submit,
    closeOverlay,
    goto: setView,
    selectCostSku: setCostSku,
    selectForecastSku: setForecastSku,
    setSuggest,
    setPromo,
    setSpot,
    setBooted,
    setStagger,
  })

  return (
    <div className="app" data-spot={spot || ''} data-demo={demo ? '1' : ''} data-stagger={stagger ? '1' : ''}>
      <Rail view={view} onView={setView} />
      <TopBar />
      <main className={`main ${booted ? '' : 'hidden'}`}>
        {view === 'today' && <Today cardProps={cardProps} />}
        {view === 'forecast' && <Forecast sku={forecastSku} onSku={setForecastSku} />}
        {view === 'cost' && (
          <StockCost
            sku={costSku}
            onSku={setCostSku}
            suggestShown={suggestShown}
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
