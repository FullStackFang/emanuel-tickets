'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { issueTicketsForOrder } from '@/lib/tickets'
import { startPaidCheckout } from '@/lib/checkout'
import { viewOf, type EventRecord } from '@/lib/event-format'
import { planPurchase, reserveErrorMessage } from '@/lib/purchase'
import { getViewer } from '@/lib/supabase/viewer'
import { ensureFreshMembership } from '@/lib/membership/verify'

// Same shape event data is read with elsewhere; kept local so the action stays
// server-authoritative and never trusts values the client sent for pricing.
const SELECT =
  'id,title,description,location,starts_at,status,category,group_slug,ticket_types(id,name,price_cents,member_price_cents,members_only,capacity,sold,held)'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PARTY = 20

export type RsvpState =
  | { ok: true; guests: number; name: string; ticketUrl?: string; emailed: boolean }
  | { ok: false; error: string }
  | null

// Free-event RSVP. This is a public POST endpoint (Server Actions are reachable
// directly, not just via our UI), so every check is re-done here against the
// database — the client's "isFree" claim is never trusted.
export async function rsvpToEvent(_prev: RsvpState, formData: FormData): Promise<RsvpState> {
  const eventId = String(formData.get('eventId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const guests = Number.parseInt(String(formData.get('guests') ?? '1'), 10)

  if (!name) return { ok: false, error: 'Please enter your name.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_PARTY)
    return { ok: false, error: `Guest count must be between 1 and ${MAX_PARTY}.` }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('events')
    .select(SELECT)
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw error
  const event = data as EventRecord | null
  if (!event || event.status !== 'published')
    return { ok: false, error: 'This event is no longer available.' }

  if (viewOf(event).hasEnded) return { ok: false, error: 'This event has already taken place.' }

  // Identity and membership come from the verified session and the membership
  // cache, never from the form. Guests get neither.
  const viewer = await getViewer()
  const { isMember } = await ensureFreshMembership(viewer)

  // The chosen type's price for THIS viewer must be $0 to take the free path.
  const ticketTypeId = String(formData.get('ticketTypeId') ?? '') || undefined
  const plan = planPurchase(event.ticket_types, { path: 'rsvp', ticketTypeId, isMember, qty: guests })
  if (!plan.ok) {
    if (plan.statusChanged) revalidatePath(`/e/${event.id}`)
    return { ok: false, error: plan.error }
  }
  const { ticket } = plan

  // Hold seats atomically. reserve_seat re-checks capacity under a row lock and
  // enforces members-only from the server's assertion — the checks above are UX.
  const { data: reservation, error: reserveErr } = await supabase.rpc('reserve_seat', {
    p_ticket_type_id: ticket.id,
    p_qty: guests,
    p_is_member: isMember,
  })
  if (reserveErr) {
    const message = reserveErrorMessage(
      reserveErr,
      'Sorry — there aren’t enough spots left for that many guests.',
    )
    if (message) return { ok: false, error: message }
    throw reserveErr
  }

  // Create the zero-cost order tied to the hold, then confirm it immediately
  // (free events have no Stripe webhook to do this). confirm_order commits
  // held -> sold and writes one attendee row per seat; it is idempotent.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      reservation_id: (reservation as { id: string }).id,
      ticket_type_id: ticket.id,
      qty: guests,
      buyer_email: email,
      buyer_name: name,
      amount_cents: 0,
      user_id: viewer?.userId ?? null,
      member_pricing: plan.memberPricing,
      status: 'pending',
    })
    .select('id')
    .single()
  if (orderErr) throw orderErr

  const orderId = (order as { id: string }).id
  const { error: confirmErr } = await supabase.rpc('confirm_order', {
    p_order_id: orderId,
    p_provider_event_id: `free:${orderId}`, // synthetic, unique per order (no payment provider)
  })
  if (confirmErr) throw confirmErr

  // Mint a ticket (token + QR) per seat and email them. The seat is already
  // confirmed, so a delivery/issuance hiccup must not fail the RSVP -- log it and
  // let the buyer proceed (issueTicketsForOrder is idempotent and can be retried).
  // The future Stripe webhook calls this same function; that is the payment seam.
  let ticketUrl: string | undefined
  let emailed = false
  try {
    const result = await issueTicketsForOrder(orderId)
    ticketUrl = result.ticketUrls[0]
    emailed = result.delivered
  } catch (err) {
    console.error(`RSVP ${orderId}: ticket issuance failed`, err)
  }

  // The event page is force-dynamic, but revalidate so any cached view reflects
  // the seats we just took.
  revalidatePath(`/e/${event.id}`)
  return { ok: true, guests, name, ticketUrl, emailed }
}

export type CheckoutState = { ok: false; error: string } | null

// Paid checkout: reserve -> pending order -> provider session -> redirect. All
// validation and pricing happen server-side in startPaidCheckout; on success the
// buyer is sent to the provider (redirect throws, so nothing runs after it).
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  // Buyer identity and membership are derived here from the verified session;
  // any user id or membership claim in the form data is ignored.
  const viewer = await getViewer()
  const { isMember } = await ensureFreshMembership(viewer)
  const eventId = String(formData.get('eventId') ?? '')
  const result = await startPaidCheckout({
    eventId,
    ticketTypeId: String(formData.get('ticketTypeId') ?? ''),
    qty: Number.parseInt(String(formData.get('qty') ?? '1'), 10),
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    buyer: viewer ? { userId: viewer.userId, email: viewer.email, isMember } : null,
  })
  if (!result.ok) {
    if (result.statusChanged) revalidatePath(`/e/${eventId}`)
    return { ok: false, error: result.error }
  }
  redirect(result.redirectUrl)
}
