import data, { englishFor } from '../data'
import DecisionCard from './DecisionCard'

/** phase: 'checking' | 'answer' | 'nomatch' */
export default function AgentOverlay({ query, phase, card, cardProps, onClose, onAsk }) {
  const en = englishFor(query)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="q">
            You asked: <b>{query}</b>
            {en && <em> (English: {en})</em>}
          </span>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {phase === 'checking' && (
          <div className="checking">
            <span className="spinner" />
            Checking your stock…
          </div>
        )}

        {phase === 'answer' && card && (
          <>
            <p className="explain">
              Here is what your stock data says. {card.confidence} confidence, based on{' '}
              {card.sources.join(' and ')}.
            </p>
            <DecisionCard card={card} {...cardProps} />
          </>
        )}

        {phase === 'nomatch' && (
          <div className="nomatch">
            <p>I can only answer from your stock data. Try one of these.</p>
            <div className="chips">
              {data.suggested_questions.map((q) => (
                <button key={q} className="chip" onClick={() => onAsk(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
