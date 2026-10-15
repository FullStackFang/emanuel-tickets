'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getViewer } from '@/lib/supabase/viewer'

// Shared sign-out, used by the header account menus and the settings page. In a
// Server Action the Supabase client is allowed to clear the auth cookies (unlike
// in a Server Component), so this fully ends the session before redirecting.
// Hosts return to the host sign-in page; members to the public home page.
export async function signOut() {
  const home = (await getViewer())?.role === 'host' ? '/login' : '/'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(home)
}

// Ends the session on every device this person has signed in on, then redirects.
export async function signOutEverywhere() {
  const home = (await getViewer())?.role === 'host' ? '/login' : '/'
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'global' })
  redirect(home)
}
