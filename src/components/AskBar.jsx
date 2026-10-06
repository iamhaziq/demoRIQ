import { MAX_QUESTION, SUGGESTED_QUESTIONS } from '../lib/ask'

export default function AskBar({ value, onChange, onSubmit, busy }) {
  return (
    <div className="askbar">
      <div className="askbar-inner">
        <div className="chips">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} className="chip" onClick={() => onSubmit(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="askrow"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(value)
          }}
        >
          <span className="label">Ask RetailIQ</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={MAX_QUESTION}
            placeholder="Ask in Malay or English: stock, cost, reorders, forecasts…"
            aria-label="Ask RetailIQ"
          />
          <button type="submit" disabled={busy || !value.trim()}>
            Ask
          </button>
        </form>
      </div>
    </div>
  )
}
