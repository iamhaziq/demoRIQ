import { useEffect, useRef } from 'react'

const CANCELLED = Symbol('cancelled')

/**
 * ?demo=1 autopilot, timed to the video script. Each shot is a chapter that starts from a clean
 * state, so `?demo=1&shot=6` records one shot on its own. Space pauses/resumes, r restarts.
 *
 * Chapter lengths follow the narration segments (shot 4 = 0:47-1:12, shot 5 = 1:12-1:35,
 * shot 6 = 1:35-2:08, shot 7 = 2:08-2:26, shot 8 = 2:26-2:38). Cut the tails in the edit.
 */
const CHAPTERS = {
  // Shot 4: app loads, hold on the shell, Today screen, slow zoom onto cash trapped
  4: async (a, s) => {
    a.reset()
    a.setBooted(false)
    await s(2500)
    a.setBooted(true)
    await s(16500)
    a.setSpot('cash')
    await s(9000)
  },

  // Shot 5: the question types itself in Malay, English subtitle, CLEAR card, "Numbers from" footer
  5: async (a, s) => {
    a.reset()
    await s(1500)
    const q = a.question
    for (let i = 1; i <= q.length; i += 1) {
      a.setAsk(q.slice(0, i))
      await s(50)
    }
    await s(1800)
    a.submit(q)
    await s(1200 + 10800) // "Checking your stock…", then the card
    a.setSpot('footer')
    await s(8000)
  },

  // Shot 6: five cost bars in narration order, total rate, break-even, 10% suggestion, promo draft
  6: async (a, s) => {
    a.reset()
    a.setStagger(true)
    a.setSuggest(false)
    a.goto('cost')
    a.selectCostSku(a.topCostSku)
    await s(20000)
    a.setSpot('breakeven')
    await s(7000)
    a.setSuggest(true)
    a.setSpot('suggest')
    await s(3500)
    a.setPromo(true)
    a.setSpot('promo')
    await s(5000)
  },

  // Shot 7: forecast line draws in, band appears, then cut to the REORDER card
  7: async (a, s) => {
    a.reset()
    a.goto('forecast')
    a.selectForecastSku(a.reorderSku)
    await s(12000)
    a.goto('today')
    a.setSpot('reorder')
    await s(7000)
  },

  // Shot 8: Debt Freedom strip
  8: async (a, s) => {
    a.reset()
    a.goto('cost')
    a.selectCostSku(a.topCostSku)
    await s(1200)
    a.setSpot('debt')
    await s(11000)
  },
}

export function useDemo(enabled, shot, api) {
  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
  })

  useEffect(() => {
    if (!enabled) return undefined
    let paused = false
    let runId = 0
    let alive = true

    const run = async () => {
      const id = ++runId
      const sleep = async (ms) => {
        // Real elapsed time, so long waits do not drift against the narration.
        let left = ms
        let last = performance.now()
        while (left > 0) {
          await new Promise((r) => setTimeout(r, Math.min(50, left)))
          if (!alive || id !== runId) throw CANCELLED
          const now = performance.now()
          if (!paused) left -= now - last
          last = now
        }
      }
      const a = new Proxy({}, { get: (_, k) => apiRef.current[k] })
      try {
        const shots = CHAPTERS[shot] ? [shot] : Object.keys(CHAPTERS).map(Number)
        for (const n of shots) {
          await CHAPTERS[n](a, sleep)
          if (shots.length > 1) await sleep(1500)
        }
      } catch (e) {
        if (e !== CANCELLED) throw e
      }
    }

    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        paused = !paused
      } else if (e.key === 'r' || e.key === 'R') {
        run()
      }
    }

    window.addEventListener('keydown', onKey)
    run()
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled, shot])
}
