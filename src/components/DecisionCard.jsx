import { useState } from 'react'
import { showValue } from '../format'

export default function DecisionCard({ card, status, onApprove, onDismiss, onWrong, onUndo }) {
  const [showDraft, setShowDraft] = useState(false)
  const [copied, setCopied] = useState(false)

  if (status === 'dismissed' || status === 'wrong') {
    return (
      <div className="dismissed">
        <span>
          {status === 'wrong' ? 'Marked as wrong (thank you, we will review it)' : 'Dismissed'}: {card.title}
        </span>
        <button onClick={onUndo}>Undo</button>
      </div>
    )
  }

  const approved = status === 'approved'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.draft)
      setCopied(true)
    } catch {
      /* clipboard unavailable: the text stays visible on screen */
    }
  }

  return (
    <article className={`card c-${card.type} ${approved ? "done" : ""}`}>
      <div className="card-top">
        <span className={`pill ${card.type}`}>{card.type}</span>
        <span className="confl">Confidence: {card.confidence}</span>
      </div>
      <h3>{card.title}</h3>
      <p className="decision">{card.decision}</p>
      <p className="why">{card.why}</p>
      <dl className="evidence">
        {card.evidence.map((e) => (
          <div key={e.label}>
            <dt>{e.label}</dt>
            <dd>{showValue(e.value)}</dd>
          </div>
        ))}
      </dl>
      <div className={`impact ${card.type}`}>
        <span>{card.impact.label}</span>
        <b>{card.impact.value}</b>
      </div>
      <div className="actions">
        <button className={`btn ${approved ? 'approved' : 'primary'}`} onClick={onApprove} disabled={approved}>
          {approved ? '✓ Approved' : 'Approve'}
        </button>
        <button className="btn" onClick={() => setShowDraft((v) => !v)}>
          Draft message
        </button>
        {!approved && (
          <button className="btn ghost" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      {showDraft && (
        <div className="draft">
          {card.draft}
          <div>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      <p className="src">
        Numbers from: {card.sources.join(', ')}
        {onWrong && !approved && (
          <button className="wrong-link" onClick={onWrong}>
            Wrong?
          </button>
        )}
      </p>
    </article>
  )
}
