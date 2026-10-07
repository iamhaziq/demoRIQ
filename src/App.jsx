import { useState } from 'react'
import { useAsk } from './lib/useAsk'
import { Rail, TopBar } from './components/Shell'
import AskBar from './components/AskBar'
import AgentOverlay from './components/AgentOverlay'
import Today from './screens/Today'
import Forecast from './screens/Forecast'
import StockCost from './screens/StockCost'
import Upload from './screens/Upload'
import Settings from './screens/Settings'

export default function App({ shop, onShopChange, onSignOut }) {
  const [view, setView] = useState('today')
  const [text, setText] = useState('')
  const { ask, submit, close } = useAsk()

  const askQuestion = (q) => {
    setText(q)
    submit(q)
  }

  return (
    <div className="app">
      <Rail view={view} onView={setView} />
      <TopBar shop={shop} onSignOut={onSignOut} />
      <main className="main">
        {view === 'today' && <Today shop={shop} onUpload={() => setView('upload')} />}
        {view === 'forecast' && <Forecast />}
        {view === 'cost' && <StockCost />}
        {view === 'upload' && <Upload shop={shop} />}
        {view === 'settings' && <Settings shop={shop} onShopChange={onShopChange} />}
      </main>
      {ask && <AgentOverlay ask={ask} onClose={close} onAsk={askQuestion} />}
      <AskBar value={text} onChange={setText} onSubmit={askQuestion} busy={ask?.phase === 'checking'} />
    </div>
  )
}
