import { configured, supabase } from './lib/supabase'
import { useSession, useShop } from './lib/useSession'
import App from './App'
import Login from './screens/Login'

function Message({ title, children }) {
  return (
    <div className="login">
      <div className="login-card panel">
        <div className="login-brand">RetailIQ</div>
        <h1>{title}</h1>
        <div className="sub">{children}</div>
      </div>
    </div>
  )
}

function Signed({ session }) {
  const { shop, loading, error } = useShop(session)
  if (loading) return <Message title="Loading your shop…" />
  if (error || !shop) {
    return (
      <Message title="We could not load your shop">
        <p>{error?.message ?? 'No shop is linked to this account yet.'}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Message>
    )
  }
  return <App shop={shop} onSignOut={() => supabase.auth.signOut()} />
}

function Gate() {
  const session = useSession()
  if (session === undefined) return <Message title="Loading…" />
  if (!session) return <Login />
  return <Signed session={session} />
}

export default function Root() {
  if (!configured) {
    return (
      <Message title="Not connected to Supabase">
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>).
      </Message>
    )
  }
  return <Gate />
}
