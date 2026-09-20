import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'
import Cards from './Cards.jsx'

const showCards = new URLSearchParams(window.location.search).get('cards') === '1'

createRoot(document.getElementById('root')).render(
  <StrictMode>{showCards ? <Cards /> : <App />}</StrictMode>,
)
