'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import RoseSpinner from '@/components/RoseSpinner'
import './login.css'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [warm, setWarm] = useState(false)
  const hasError =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') === 'auth'

  async function signInWithMicrosoft() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setLoading(false)
      console.error(error)
    }
    // On success the browser is redirected to Microsoft; nothing else to do.
  }

  // The rose rests calm, warms while the host is on the button, and runs its
  // full loading sweep once sign-in is under way.
  const roseState = loading ? 'is-busy' : warm ? 'is-warm' : ''

  return (
    <main className="login-main">
      <div className="login-card">
        <div className={`login-rose ${roseState}`}>
          <RoseSpinner size={88} label="" />
        </div>

        <h1 className="login-title">Emanuel Tickets</h1>
        <p className="login-subtitle">Host sign in</p>

        {hasError && (
          <p className="login-error" role="alert">
            Sign-in failed. Please try again.
          </p>
        )}

        <button
          type="button"
          onClick={signInWithMicrosoft}
          onMouseEnter={() => setWarm(true)}
          onMouseLeave={() => setWarm(false)}
          onFocus={() => setWarm(true)}
          onBlur={() => setWarm(false)}
          disabled={loading}
          className="login-btn focus-ring"
        >
          {loading ? (
            <>
              <span className="btn-spinner dark" aria-hidden="true" />
              Redirecting…
            </>
          ) : (
            <>
              <MicrosoftLogo />
              Sign in with Microsoft
            </>
          )}
        </button>

        <p className="login-foot">For Temple Emanuel staff</p>
      </div>
    </main>
  )
}

// Microsoft's four-square mark, in its official brand colors.
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}
