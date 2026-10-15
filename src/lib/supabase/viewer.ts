import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Who is signed in, and as what. The role is stamped into the access token by the
// custom access token hook (supabase/migrations/20261014120000_member_auth.sql):
// `host` only for Microsoft-OAuth sessions of staff accounts, `member` otherwise.
// Read from the verified JWT via getClaims(); user_metadata is never consulted.
export type ViewerRole = 'host' | 'member'
export type Viewer = { userId: string; email: string; role: ViewerRole }

type AppClaims = {
  sub?: string
  email?: string
  app_metadata?: { app_role?: string }
}

// Cached per request so the header, page, and actions share one verification.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    // A refused refresh (including the hook's "Staff sign in with Microsoft" 403)
    // means signed out. Clear the cookies so the browser stops retrying; this is a
    // no-op in Server Components, where the proxy does the same on the next request.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    return null
  }
  const claims = data?.claims as AppClaims | undefined
  if (!claims?.sub) return null
  return {
    userId: claims.sub,
    email: claims.email ?? '',
    role: claims.app_metadata?.app_role === 'host' ? 'host' : 'member',
  }
})

// Gate for host-only pages and actions: members go home, signed-out visitors to /login.
export async function requireHost(): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'host') redirect('/')
  return viewer
}
