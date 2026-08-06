import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import Header from './Header'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="centered-page">Loading…</div>
  }

  if (!session) {
    const handleLogin = async (e) => {
      e.preventDefault()
      setError('')
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      })
      if (error) setError(error.message)
      else setSent(true)
    }

    return (
      <div className="centered-page">
        <Header title="Sign In" />
        <form onSubmit={handleLogin} className="login-form">
          {sent ? (
            <p>Check your email for a sign-in link.</p>
          ) : (
            <>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@impi-secure.co.za"
                />
              </label>
              <button type="submit">Send Sign-In Link</button>
              {error && <p className="error-text">{error}</p>}
            </>
          )}
        </form>
      </div>
    )
  }

  return children
}
