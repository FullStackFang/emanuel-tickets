'use server'

import { revalidatePath } from 'next/cache'
import { getViewer } from '@/lib/supabase/viewer'
import { checkAgain } from '@/lib/membership/verify'
import { safeNext } from '@/lib/safe-next'

// "Check again" from a member prompt (launch-member-signin, D5): an immediate CRM
// lookup for the signed-in attendee, even during an outage back-off, at most once
// every 2 minutes. Hosts and guests are ignored. Re-renders the page it came from.
export async function checkMembershipAgain(formData: FormData) {
  const viewer = await getViewer()
  if (viewer?.role === 'attendee') await checkAgain(viewer)
  revalidatePath(safeNext(String(formData.get('path') ?? '')))
}
