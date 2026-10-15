import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the auth session on each request and guards protected routes.
// Adapted from the @supabase/ssr Next.js pattern for Next 16's proxy.ts.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: do not run code between createServerClient and getClaims() — it can
  // cause hard-to-debug session-refresh bugs.
  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    // Refused refresh (e.g. the hook's staff 403): treat as signed out and clear
    // the auth cookies on this response so the browser does not keep retrying.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  const claims = error ? null : data?.claims
  const role = (claims?.app_metadata as { app_role?: string } | undefined)?.app_role

  // Host area requires a host session: members go home, signed-out to /login.
  if (request.nextUrl.pathname.startsWith('/dashboard') && role !== 'host') {
    const url = request.nextUrl.clone()
    url.pathname = claims?.sub ? '/' : '/login'
    url.search = ''
    const redirectResponse = NextResponse.redirect(url)
    // Carry any refreshed/cleared auth cookies onto the redirect.
    supabaseResponse.cookies.getAll().forEach((c) => redirectResponse.cookies.set(c))
    return redirectResponse
  }

  // Return supabaseResponse as-is so refreshed auth cookies reach the browser.
  return supabaseResponse
}
