import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState('')

  const send = async (e) => {
    e.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <div className="login">
      <div className="login-card panel">
        <div className="login-brand">RetailIQ</div>
        <h1>Sign in to your shop</h1>
        <p className="sub">Log masuk ke kedai anda. We email you a link; no password needed.</p>

        {state === 'sent' ? (
          <div className="login-sent" role="status">
            <b>Check your email.</b> We sent a sign-in link to {email.trim()}. Open it on this device.
            <button className="btn ghost" onClick={() => setState('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={send}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@kedai.my"
            />
            <button className="btn primary" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {state === 'error' && (
              <p className="login-error" role="alert">
                Could not send the link: {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
