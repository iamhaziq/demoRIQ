import { useEffect, useState } from 'react'
import pitch from './data/pitch-content.json'

/** Count up to a fixed figure. The end value is exactly the figure in pitch-content.json. */
function CountUp({ to, decimals, suffix, ms = 1800 }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf
    const t0 = performance.now()
    const tick = (now) => {
      const k = Math.min((now - t0) / ms, 1)
      setV(k === 1 ? to : to * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return (
    <>
      {v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  )
}

const CARDS = [
  // 0:12 logo card
  () => (
    <div className="dk navy">
      <div className="dk-logo">RetailIQ</div>
    </div>
  ),
  // 0:12-0:30 three number cards
  ...pitch.msme.map((m) => () => (
    <div className="dk page">
      <div className="dk-num">
        <CountUp {...m} />
      </div>
      <div className="dk-label">{m.label}</div>
    </div>
  )),
  // 0:30-0:47
  () => (
    <div className="dk page">
      <div className="dk-num amber">{pitch.workingCapital.value}</div>
      <div className="dk-label">{pitch.workingCapital.text}</div>
    </div>
  ),
  // 2:26-2:38 quiet title card
  () => (
    <div className="dk navy quiet">
      {pitch.sejahtera.map((line, i) => (
        <div key={line} className="dk-quiet" style={{ animationDelay: `${0.6 + i * 1.1}s` }}>
          {line}
        </div>
      ))}
    </div>
  ),
  // 2:38-2:50 pricing
  () => (
    <div className="dk page">
      <div className="dk-prices">
        {pitch.pricing.map((t, i) => (
          <div key={t.price} className="dk-price" style={{ animationDelay: `${0.2 + i * 0.5}s` }}>
            <b>{t.price}</b>
            <span>{t.period}</span>
            <em>{t.note}</em>
          </div>
        ))}
      </div>
    </div>
  ),
  // market number
  () => (
    <div className="dk teal">
      <div className="dk-num white">{pitch.market.value}</div>
      <div className="dk-label white">{pitch.market.label}</div>
    </div>
  ),
]

/** ?cards=1 : full-screen title cards for the non-demo shots. Right/Space next, Left back. */
export default function Cards() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const onKey = (e) => {
      if (['ArrowRight', 'Space', 'Enter'].includes(e.code)) {
        e.preventDefault()
        setI((n) => Math.min(n + 1, CARDS.length - 1))
      } else if (e.code === 'ArrowLeft') {
        setI((n) => Math.max(n - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const Card = CARDS[i]
  return <Card key={i} />
}
