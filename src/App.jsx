import { useState } from 'react'
import { cardById, productsByCost } from './data'
import { useAsk } from './lib/useAsk'
import { Rail, TopBar } from './components/Shell'
import AskBar from './components/AskBar'
import AgentOverlay from './components/AgentOverlay'
import Today from './screens/Today'
import Forecast from './screens/Forecast'
import StockCost from './screens/StockCost'

const REORDER_SKU = cardById.reorder.sku
const TOP_COST_SKU = productsByCost[0].sku

export default function App({ shop, onSignOut }) {
  const [view, setView] = useState('today')
  const [text, setText] = useState('')
  const { ask, submit, close } = useAsk()
  const [costSku, setCostSku] = useState(TOP_COST_SKU)
  const [forecastSku, setForecastSku] = useState(REORDER_SKU)
  const [promoOpen, setPromo] = useState(false)

  const askQuestion = (q) => {
    setText(q)
    submit(q)
  }

  return (
    <div className="app">
      <Rail view={view} onView={setView} />
      <TopBar shop={shop} onSignOut={onSignOut} />
      <main className="main">
        {view === 'today' && <Today shop={shop} />}
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
      {ask && <AgentOverlay ask={ask} onClose={close} onAsk={askQuestion} />}
      <AskBar value={text} onChange={setText} onSubmit={askQuestion} busy={ask?.phase === 'checking'} />
    </div>
  )
}
