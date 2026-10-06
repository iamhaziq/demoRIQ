import { displayAnswer, SUGGESTED_QUESTIONS } from '../lib/ask'

/** ask: { query, phase: 'checking' | 'answer' | 'error', answer?, fallback?, error? } from useAsk. */
export default function AgentOverlay({ ask, onClose, onAsk }) {
  const { query, phase } = ask
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="q">
            You asked: <b>{query}</b>
          </span>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {phase === 'checking' && (
          <div className="checking" role="status">
            <span className="spinner" />
            Checking your stock…
          </div>
        )}

        {phase === 'answer' && (
          <div aria-live="polite">
            <p className="answer">{displayAnswer(ask.answer)}</p>
            {ask.fallback && (
              <p className="answer-note">Short answer built straight from your stored numbers.</p>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="state-box error" role="alert">
            <b>No answer.</b> {ask.error.message}
            {ask.error.retry !== false && (
              <button className="btn" onClick={() => onAsk(query)}>
                Try again
              </button>
            )}
            <div className="chips">
              {SUGGESTED_QUESTIONS.map((q) => (
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
