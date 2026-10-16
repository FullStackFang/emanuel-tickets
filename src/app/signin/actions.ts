'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAuthAdminClient } from '@/lib/supabase/auth-admin'
import { verifyMembership } from '@/lib/membership/verify'
import { safeNext } from '@/lib/safe-next'
import { siteUrl } from '@/lib/site-url'

// Attendee sign-in by one-time code (openspec add-member-auth, D3). The
// code is typed on the same page that requested it, so sign-in never depends on
// the email being opened in the same browser. /login stays host-only (Microsoft).
// OTP calls go through the secret-key client so Supabase rate-limits per person
// (launch-member-signin, D1); the session it returns is copied onto the cookies.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STAFF = 'Staff sign in with Microsoft'

export type SignInState =
  | { step: 'email'; error?: string }
  | { step: 'code'; email: string; error?: string; staff?: boolean }

export async function requestCode(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const next = safeNext(String(formData.get('next') ?? ''))
  if (!EMAIL_RE.test(email)) return { step: 'email', error: 'Please enter a valid email address.' }

  const auth = await createAuthAdminClient()
  const { error } = await auth.auth.signInWithOtp({
    email,
    // The link in the email returns through /auth/confirm to this destination.
    options: { shouldCreateUser: true, emailRedirectTo: `${siteUrl()}${next}` },
  })
  if (error) {
    if (error.status === 429)
      return { step: 'email', error: 'Please wait a minute before asking for another code.' }
    return { step: 'email', error: 'We couldn’t send a code just now. Please try again.' }
  }
  return { step: 'code', email }
}

export async function verifyCode(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const token = String(formData.get('token') ?? '').replace(/\s+/g, '')
  const next = safeNext(String(formData.get('next') ?? ''))

  const auth = await createAuthAdminClient()
  const { data, error } = await auth.auth.verifyOtp({ email, token, type: 'email' })
  if (error || !data.user || !data.session) {
    // The access token hook refuses non-Microsoft sessions for staff accounts.
    if (error?.status === 403 || error?.message?.includes(STAFF))
      return { step: 'code', email, staff: true, error: STAFF }
    return {
      step: 'code',
      email,
      error: 'That code didn’t work. It may have expired — check the newest email or request a new code.',
    }
  }

  const supabase = await createClient()
  const { error: sessionError } = await supabase.auth.setSession(data.session)
  if (sessionError) return { step: 'code', email, error: 'We couldn’t sign you in just now. Please try again.' }

  // Ask the CRM now so the member price shows on the very next page. Never throws.
  await verifyMembership(data.user.id, data.user.email ?? email)
  redirect(next)
}
