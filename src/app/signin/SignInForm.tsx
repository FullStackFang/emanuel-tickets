'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { requestCode, verifyCode, type SignInState } from './actions'

const INPUT =
  'focus-ring h-12 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]'
const PRIMARY =
  'focus-ring inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary-600 px-6 text-base font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70'

// Email step, then code step, on the same page. Keyed so "use a different email"
// starts over cleanly.
export function SignInForm({ next, linkError }: { next: string; linkError?: string }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <Steps key={attempt} next={next} linkError={attempt === 0 ? linkError : undefined} restart={() => setAttempt((n) => n + 1)} />
  )
}

function Steps({ next, linkError, restart }: { next: string; linkError?: string; restart: () => void }) {
  const [sent, sendAction, sending] = useActionState<SignInState, FormData>(requestCode, { step: 'email' })
  const [checked, checkAction, checking] = useActionState<SignInState, FormData>(verifyCode, { step: 'email' })

  if (sent.step === 'email') {
    const error = sent.error ?? linkError
    return (
      <form action={sendAction} className="grid w-full gap-3 text-left">
        <input type="hidden" name="next" value={next} />
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold text-[var(--text-secondary)]">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            className={INPUT}
          />
        </label>
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={sending} className={PRIMARY}>
          {sending ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
    )
  }

  const email = sent.email
  const error = checked.step === 'code' ? checked : null
  return (
    <form action={checkAction} className="grid w-full gap-3 text-left">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-[var(--text-secondary)]">
        We sent a code to <strong className="text-[var(--text-primary)]">{email}</strong>. It may take a
        minute to arrive.
      </p>
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold text-[var(--text-secondary)]">6-digit code</span>
        <input
          name="token"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,8}"
          maxLength={8}
          placeholder="123456"
          className={`${INPUT} text-center font-mono text-xl tracking-[0.3em]`}
        />
      </label>
      {error?.error && (
        <p role="alert" className="login-error">
          {error.error}
          {error.staff && (
            <>
              {' '}
              <Link href="/login" className="font-semibold underline underline-offset-2">
                Go to staff sign-in
              </Link>
            </>
          )}
        </p>
      )}
      <button type="submit" disabled={checking} className={PRIMARY}>
        {checking ? 'Checking…' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={restart}
        className="focus-ring justify-self-center rounded text-sm text-[var(--text-secondary)] underline underline-offset-4"
      >
        Use a different email or get a new code
      </button>
    </form>
  )
}
