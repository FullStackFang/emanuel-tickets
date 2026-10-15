// Paid checkout domain logic (design D5, D6, D9; spec ticket-checkout). SERVER-ONLY.
// Provider-neutral: everything vendor-specific sits behind getPaymentProvider().
//
//   startPaidCheckout : reserve -> pending order -> provider session -> redirect
//   applyPaymentEvent : normalized provider event -> confirm_order -> tickets
//
// orders.provider_ref is stored as "<providerId>:<providerRef>" so one column
// says both which processor owns the session and how to find it.

import { createAdminClient } from '@/lib/supabase/admin'
import { issueTicketsForOrder } from '@/lib/tickets'
import { siteUrl } from '@/lib/site-url'
import { viewOf, type EventRecord } from '@/lib/event-format'
import { getPaymentProvider, type PaymentEvent } from '@/lib/payments'
import { planPurchase, reserveErrorMessage } from '@/lib/purchase'

// Stripe Checkout Sessions live at least 30 minutes. The seat hold must outlive
// the session by a webhook-slack margin (design D5), so: session = 30, hold = 35.
export const SESSION_MINUTES = 30
export const HOLD_MINUTES = SESSION_MINUTES + 5
export const MAX_QTY = 20

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SELECT =
  'id,title,description,location,starts_at,status,category,group_slug,ticket_types(id,name,price_cents,member_price_cents,members_only,capacity,sold,held)'

export type StartResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string; statusChanged?: true }

// `buyer` is supplied by trusted server code from the verified session and the
// membership cache (null for guests); it never comes from form data.
export async function startPaidCheckout(input: {
  eventId: string
  ticketTypeId: string
  qty: number
  name: string
  email: string
  buyer: { userId: string; email: string; isMember: boolean } | null
}): Promise<StartResult> {
  const { eventId, ticketTypeId, qty } = input
  const name = input.name.trim()
  const email = input.email.trim()
  if (!name) return { ok: false, error: 'Please enter your name.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY)
    return { ok: false, error: `Ticket count must be between 1 and ${MAX_QTY}.` }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('events').select(SELECT).eq('id', eventId).maybeSingle()
  if (error) throw error
  const event = data as EventRecord | null
  if (!event || event.status !== 'published')
    return { ok: false, error: 'This event is no longer available.' }
  const v = viewOf(event)
  if (v.hasEnded) return { ok: false, error: 'This event has already taken place.' }

  // Price comes from the database and the server-derived membership, never from
  // the form. The effective price must be > 0 here: $0 goes through RSVP, so the
  // provider is never asked for a $0 session.
  const isMember = input.buyer?.isMember ?? false
  const plan = planPurchase(event.ticket_types, { path: 'checkout', ticketTypeId, isMember, qty })
  if (!plan.ok) return plan
  const { ticket } = plan

  // Hold seats atomically (the real capacity gate, and members-only enforcement).
  const { data: reservation, error: reserveErr } = await supabase.rpc('reserve_seat', {
    p_ticket_type_id: ticket.id,
    p_qty: qty,
    p_hold_minutes: HOLD_MINUTES,
    p_is_member: isMember,
  })
  if (reserveErr) {
    const message = reserveErrorMessage(reserveErr, 'Sorry — there aren’t enough tickets left for that many.')
    if (message) return { ok: false, error: message }
    throw reserveErr
  }
  const res = reservation as { id: string; expires_at: string }

  const amountCents = plan.unitCents * qty
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      reservation_id: res.id,
      ticket_type_id: ticket.id,
      qty,
      buyer_email: email,
      buyer_name: name,
      amount_cents: amountCents,
      currency: 'usd',
      user_id: input.buyer?.userId ?? null,
      member_pricing: plan.memberPricing,
      status: 'pending',
    })
    .select('id')
    .single()
  if (orderErr) throw orderErr
  const orderId = (order as { id: string }).id

  const provider = await getPaymentProvider()
  const start = await provider.createCheckout({
    orderId,
    amountCents,
    currency: 'usd',
    description: `${event.title} — ${ticket.name}${qty > 1 ? ` × ${qty}` : ''}`,
    buyerEmail: input.buyer?.email || email, // prefill the provider from the session when signed in
    successUrl: `${siteUrl()}/checkout/${orderId}`,
    cancelUrl: `${siteUrl()}/e/${event.id}`,
    idempotencyKey: res.id,
    expiresAt: new Date(new Date(res.expires_at).getTime() - 5 * 60_000),
  })
  if (start.kind !== 'redirect')
    throw new Error(`provider ${provider.id} returned an embedded checkout; no client component is wired yet`)

  // Commit the provider reference BEFORE redirecting so the webhook can find us.
  const { error: refErr } = await supabase
    .from('orders')
    .update({ provider_ref: `${provider.id}:${start.providerRef}` })
    .eq('id', orderId)
  if (refErr) throw refErr

  return { ok: true, redirectUrl: start.url }
}

export class OrderNotFoundError extends Error {
  constructor(ref: string) {
    super(`no order for provider ref ${ref}`)
    this.name = 'OrderNotFoundError'
  }
}

export type ApplyResult = {
  orderId: string
  status: 'confirmed' | 'pending' | 'expired' | 'cancelled'
  needsRefund: boolean
  ticketUrls: string[]
}

// Apply one normalized provider event. Idempotent end to end: confirm_order
// dedupes on the ledger id and short-circuits on an already-confirmed order;
// issueTicketsForOrder mints only rows that still lack a token.
export async function applyPaymentEvent(
  providerId: string,
  event: PaymentEvent,
): Promise<ApplyResult> {
  const supabase = createAdminClient()
  const ref = `${providerId}:${event.providerRef}`
  const { data: found, error } = await supabase
    .from('orders')
    .select('id, status, amount_cents, needs_refund')
    .eq('provider_ref', ref)
    .maybeSingle()
  if (error) throw error
  if (!found) throw new OrderNotFoundError(ref)
  const order = found as { id: string; status: ApplyResult['status']; amount_cents: number; needs_refund: boolean }
  const ledgerId = `${providerId}:${event.providerEventId}`

  switch (event.status) {
    case 'paid': {
      if (event.amountCents != null && event.amountCents !== order.amount_cents)
        console.error(
          `payments: amount mismatch on order ${order.id}: provider ${event.amountCents}, order ${order.amount_cents}`,
        )
      const { data: confirmed, error: confirmErr } = await supabase.rpc('confirm_order', {
        p_order_id: order.id,
        p_provider_event_id: ledgerId,
      })
      if (confirmErr) {
        if (confirmErr.code === 'P0002') throw new OrderNotFoundError(ref)
        throw confirmErr
      }
      const c = confirmed as { status: ApplyResult['status']; needs_refund: boolean }
      let ticketUrls: string[] = []
      if (c.status === 'confirmed' && !c.needs_refund) {
        try {
          ticketUrls = (await issueTicketsForOrder(order.id)).ticketUrls
        } catch (err) {
          // Seats are committed; issuance is retryable. Never fail the webhook for it.
          console.error(`payments: ticket issuance failed for order ${order.id}`, err)
        }
      }
      return { orderId: order.id, status: c.status, needsRefund: c.needs_refund, ticketUrls }
    }
    case 'failed':
    case 'expired': {
      // Close the order; the hold itself is returned by the authoritative sweep
      // when expires_at passes (at most 5 minutes after the provider session).
      const next = event.status === 'expired' ? 'expired' : 'cancelled'
      const { error: updErr } = await supabase
        .from('orders')
        .update({ status: next })
        .eq('id', order.id)
        .eq('status', 'pending')
      if (updErr) throw updErr
      return {
        orderId: order.id,
        status: order.status === 'pending' ? next : order.status,
        needsRefund: order.needs_refund,
        ticketUrls: [],
      }
    }
    case 'refunded': {
      // Phase 1: void the tickets so the door rejects them. Returning seats to
      // inventory and the staff refund button are phase 2 (plan S4).
      const { error: revErr } = await supabase
        .from('attendees')
        .update({ status: 'revoked' })
        .eq('order_id', order.id)
      if (revErr) throw revErr
      return { orderId: order.id, status: order.status, needsRefund: false, ticketUrls: [] }
    }
    case 'pending':
    default:
      return { orderId: order.id, status: order.status, needsRefund: order.needs_refund, ticketUrls: [] }
  }
}

// For the post-payment return page: the provider is authoritative, so if it says
// paid and the webhook has not landed yet, fulfil here through the same path.
export async function settleOrderFromReturn(orderId: string): Promise<ApplyResult | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, provider_ref, needs_refund')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const order = data as { id: string; status: ApplyResult['status']; provider_ref: string | null; needs_refund: boolean }
  if (order.status !== 'pending' || !order.provider_ref)
    return { orderId: order.id, status: order.status, needsRefund: order.needs_refund, ticketUrls: [] }

  const sep = order.provider_ref.indexOf(':')
  const providerId = order.provider_ref.slice(0, sep)
  const providerRef = order.provider_ref.slice(sep + 1)
  const provider = await getPaymentProvider(providerId)
  const status = await provider.getStatus(providerRef)
  if (status === 'pending')
    return { orderId: order.id, status: 'pending', needsRefund: false, ticketUrls: [] }
  return applyPaymentEvent(providerId, {
    providerEventId: `return:${providerRef}`,
    providerRef,
    status,
    amountCents: null,
  })
}
