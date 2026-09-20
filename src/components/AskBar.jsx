import data, { englishFor } from '../data'

export default function AskBar({ value, onChange, onSubmit }) {
  const subtitle = englishFor(value)
  return (
    <div className="askbar">
      <div className="askbar-inner">
        <div className="chips">
          {data.suggested_questions.map((q) => (
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
            placeholder="Ask in Malay or English: stock, cost, reorders, loan…"
            aria-label="Ask RetailIQ"
          />
          <button type="submit">Ask</button>
        </form>
        <div className="subtitle" aria-live="polite">
          {subtitle ? `English: ${subtitle}` : ''}
        </div>
      </div>
    </div>
  )
}
