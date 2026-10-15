'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getViewer } from '@/lib/supabase/viewer'

export type SaveResult = { ok: true } | { ok: false; error: string }

// Host display name and notification preferences are stored in the Supabase auth
// user's metadata (there is no profiles table). Both actions re-check the session
// server-side before writing.

export async function updateDisplayName(name: string): Promise<SaveResult> {
  const trimmed = name.trim()
  if (trimmed.length < 2) return { ok: false, error: 'Name must be at least 2 characters.' }
  if (trimmed.length > 80) return { ok: false, error: 'Name must be 80 characters or fewer.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Your session has expired. Please sign in again.' }
  if ((await getViewer())?.role !== 'host') return { ok: false, error: 'Only hosts can change these settings.' }

  const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
  if (error) return { ok: false, error: 'Could not save your name. Please try again.' }

  // The header derives the host's name from this metadata.
  revalidatePath('/dashboard/settings')
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function updateNotifications(prefs: {
  notifyRsvp: boolean
  notifyWeekly: boolean
}): Promise<SaveResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Your session has expired. Please sign in again.' }
  if ((await getViewer())?.role !== 'host') return { ok: false, error: 'Only hosts can change these settings.' }

  const { error } = await supabase.auth.updateUser({
    data: { notify_rsvp: prefs.notifyRsvp, notify_weekly: prefs.notifyWeekly },
  })
  if (error) return { ok: false, error: 'Could not save your preferences. Please try again.' }

  return { ok: true }
}
