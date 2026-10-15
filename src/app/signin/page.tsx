import Link from 'next/link'
import type { Metadata } from 'next'
import { SignInForm } from './SignInForm'
import { safeNext } from '@/lib/safe-next'
import '../login/login.css'

export const metadata: Metadata = { title: 'Sign in · Emanuel Tickets' }

// Attendee sign-in. Opened from an event page's "Sign in with your email" link
// (?next=/e/<id>) or from a failed email link (?error=code).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams
  return (
    <main className="login-main">
      <div className="login-card">
        <h1 className="login-title">Sign in with your email</h1>
        <p className="login-subtitle">We&rsquo;ll email you a 6-digit code. No password needed.</p>
        {error === 'staff' && (
          <p role="alert" className="login-error">
            Staff sign in with Microsoft.{' '}
            <Link href="/login" className="font-semibold underline underline-offset-2">
              Go to staff sign-in
            </Link>
          </p>
        )}
        <SignInForm
          next={safeNext(next)}
          linkError={error === 'code' ? 'That sign-in link didn’t work or has expired. Request a new code below.' : undefined}
        />
      </div>
    </main>
  )
}
