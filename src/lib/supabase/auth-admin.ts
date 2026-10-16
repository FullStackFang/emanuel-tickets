import 'server-only'
import { headers } from 'next/headers'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// Auth client for the sign-in path (openspec launch-member-signin, D1). Uses the
// Supabase secret key (sb_secret_…) so Supabase honors `sb-forwarded-for` and
// counts OTP rate limits per end user instead of per Vercel server. The legacy
// service_role key is not accepted for forwarding. Requires IP forwarding enabled
// under Auth › Rate Limits on the hosted project.
//
// No session is kept here: callers copy the returned session onto the cookie
// client with setSession(). Built per request because the forwarded IP differs.
export async function createAuthAdminClient(): Promise<SupabaseClient> {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set. Add it to .env.local and the Vercel project env.')
  const ip = (await headers()).get('x-real-ip') // set by Vercel; absent in local dev
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: ip ? { 'sb-forwarded-for': ip } : {} },
  })
}
