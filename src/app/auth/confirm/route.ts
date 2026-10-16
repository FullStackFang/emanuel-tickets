import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAuthAdminClient } from '@/lib/supabase/auth-admin'
import { verifyMembership } from '@/lib/membership/verify'
import { safeNext } from '@/lib/safe-next'

// Email-link sign-in for attendees (openspec add-member-auth, D3). The link in the
// code email carries a token_hash, which works in whatever browser opens it (a mail
// app's in-app browser included) — unlike a PKCE link, which needs the requesting
// browser's cookie. Only type=email is accepted, so recovery or email-change links
// can never establish a session here. Verified through the secret-key client so the
// rate limit counts this person (launch-member-signin, D1), then written to cookies.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next'), origin)

  if (tokenHash && type === 'email') {
    const auth = await createAuthAdminClient()
    const { data, error } = await auth.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    const signedIn =
      !error && data.user && data.session && !(await (await createClient()).auth.setSession(data.session)).error
    if (signedIn && data.user) {
      await verifyMembership(data.user.id, data.user.email ?? '') // never throws
      return NextResponse.redirect(`${origin}${next}`)
    }
    if (error?.status === 403) return NextResponse.redirect(`${origin}/signin?error=staff`)
  }
  return NextResponse.redirect(`${origin}/signin?error=code`)
}
