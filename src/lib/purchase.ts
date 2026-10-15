// Per-ticket-type purchase routing (openspec add-member-auth, design D6). Pure:
// no DB, no session. rsvpToEvent and startPaidCheckout both resolve the chosen
// ticket type here from DATABASE rows and the SERVER-derived membership, so a $0
// effective price can never reach the payment provider and a paid one can never
// slip through the free path.

import { effectivePriceCents, type TicketType } from './event-format.ts'

export type PurchasePath = 'rsvp' | 'checkout'

export const MEMBERS_ONLY_MESSAGE =
  'This ticket is for members. Sign in with your member email to reserve it.'
export const STATUS_CHANGED_MESSAGE = 'Your membership status changed; the page has been refreshed.'

export type PurchasePlan =
  | { ok: true; ticket: TicketType; unitCents: number; memberPricing: boolean }
  | { ok: false; error: string; statusChanged?: true }

const remaining = (t: TicketType) => t.capacity - t.sold - t.held
const fitsPath = (cents: number, path: PurchasePath) => (path === 'rsvp' ? cents === 0 : cents > 0)

export function planPurchase(
  types: TicketType[],
  { path, ticketTypeId, isMember, qty }: { path: PurchasePath; ticketTypeId?: string; isMember: boolean; qty: number },
): PurchasePlan {
  let ticket: TicketType | undefined
  if (ticketTypeId) {
    ticket = types.find((t) => t.id === ticketTypeId)
    if (!ticket) return { ok: false, error: 'That ticket type is not available.' }
  } else if (path === 'rsvp') {
    // No type posted (single-type free events): prefer a $0-for-this-viewer type that
    // can hold the whole party, else any, so reserve_seat gives the definitive answer.
    const free = types.filter((t) => effectivePriceCents(t, isMember) === 0 && (isMember || !t.members_only))
    ticket = free.find((t) => remaining(t) >= qty) ?? free[0]
    if (!ticket) {
      const freeOtherwise = types.some((t) => effectivePriceCents(t, !isMember) === 0)
      return freeOtherwise
        ? { ok: false, error: STATUS_CHANGED_MESSAGE, statusChanged: true }
        : { ok: false, error: 'This event requires tickets, not a free RSVP.' }
    }
  } else {
    return { ok: false, error: 'Please choose a ticket type.' }
  }

  const unitCents = effectivePriceCents(ticket, isMember)
  if (!fitsPath(unitCents, path)) {
    // The page priced this type under the other membership status (the fresh check
    // disagreed with what was rendered): tell the viewer and re-render.
    if (fitsPath(effectivePriceCents(ticket, !isMember), path))
      return { ok: false, error: STATUS_CHANGED_MESSAGE, statusChanged: true }
    return {
      ok: false,
      error:
        path === 'rsvp'
          ? 'This ticket requires checkout, not a free RSVP.'
          : 'This ticket is free; use RSVP instead of checkout.',
    }
  }
  return { ok: true, ticket, unitCents, memberPricing: isMember && ticket.member_price_cents != null }
}

// Map a reserve_seat failure to attendee copy. Members-only (42501) is checked
// BEFORE the inventory branch so it is never reported as "sold out". Returns null
// for anything unexpected, which the caller rethrows.
export function reserveErrorMessage(
  err: { code?: string; message?: string },
  soldOutMessage: string,
): string | null {
  if (err.code === '42501' || err.message?.includes('members_only')) return MEMBERS_ONLY_MESSAGE
  if (err.code === 'P0001' || err.message?.includes('insufficient_inventory')) return soldOutMessage
  return null
}
