'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { parseEventForm } from '@/lib/event-input'
import { requireHost } from '@/lib/supabase/viewer'

// Same shape as the create form: success redirects, so the only rendered state
// is a validation/authorization error.
export type UpdateEventState = { ok: false; error: string } | null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function updateEvent(
  _prev: UpdateEventState,
  formData: FormData,
): Promise<UpdateEventState> {
  await requireHost()
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '')
  if (!UUID_RE.test(id)) return { ok: false, error: 'That event could not be found.' }

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const {
    title,
    description,
    location,
    category,
    startsAt,
    capacity,
    priceCents,
    memberPriceCents,
    membersOnly,
    publish,
  } = parsed.value

  // Update the event. RLS events_update_own scopes this to the host's own rows;
  // selecting the row back confirms one actually matched (exists + owned).
  const { data: updated, error: updErr } = await supabase
    .from('events')
    .update({
      title,
      description,
      location,
      starts_at: startsAt,
      category,
      status: publish ? 'published' : 'draft',
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (!updated) return { ok: false, error: 'That event could not be found, or you cannot edit it.' }

  // Keep the event's General Admission ticket type in sync. Capacity can't drop
  // below seats already taken (the DB oversell check would reject it), so guard.
  const { data: tt, error: ttSelErr } = await supabase
    .from('ticket_types')
    .select('id, sold, held')
    .eq('event_id', id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (ttSelErr) throw ttSelErr
  if (tt) {
    const taken = tt.sold + tt.held
    if (capacity < taken)
      return { ok: false, error: `Capacity can't be below the ${taken} seats already taken.` }
    const { error: ttUpdErr } = await supabase
      .from('ticket_types')
      .update({
        price_cents: priceCents,
        member_price_cents: memberPriceCents,
        members_only: membersOnly,
        capacity,
      })
      .eq('id', tt.id)
    if (ttUpdErr) throw ttUpdErr
  }

  revalidatePath('/dashboard')
  revalidatePath('/')
  revalidatePath(`/e/${id}`)
  redirect('/dashboard')
}
