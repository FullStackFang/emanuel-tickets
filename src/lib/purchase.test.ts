// Purchase routing used by rsvpToEvent and startPaidCheckout: no network, no DB.
//   node --test --experimental-strip-types src/lib/purchase.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TicketType } from './event-format.ts'
import {
  MEMBERS_ONLY_MESSAGE,
  STATUS_CHANGED_MESSAGE,
  planPurchase,
  reserveErrorMessage,
} from './purchase.ts'

const tt = (over: Partial<TicketType>): TicketType => ({
  id: 't',
  name: 'General',
  price_cents: 2500,
  member_price_cents: null,
  members_only: false,
  capacity: 10,
  sold: 0,
  held: 0,
  ...over,
})
const membersFree = [tt({ id: 'mf', member_price_cents: 0 })]

test('"members free, guests $25": member goes to immediate confirm, guest to the provider', () => {
  const member = planPurchase(membersFree, { path: 'rsvp', ticketTypeId: 'mf', isMember: true, qty: 2 })
  assert.ok(member.ok)
  assert.equal(member.unitCents, 0)
  assert.equal(member.memberPricing, true)

  const guest = planPurchase(membersFree, { path: 'checkout', ticketTypeId: 'mf', isMember: false, qty: 2 })
  assert.ok(guest.ok)
  assert.equal(guest.unitCents, 2500)
  assert.equal(guest.memberPricing, false)
})

test('the provider is never reached with amount 0', () => {
  // A member posting the $0-for-them type to checkout is refused before reserve/provider.
  const r = planPurchase(membersFree, { path: 'checkout', ticketTypeId: 'mf', isMember: true, qty: 1 })
  assert.equal(r.ok, false)
  const free = [tt({ id: 'f', price_cents: 0 })]
  const g = planPurchase(free, { path: 'checkout', ticketTypeId: 'f', isMember: false, qty: 1 })
  assert.deepEqual(g, { ok: false, error: 'This ticket is free; use RSVP instead of checkout.' })
  // Exhaustive: any plan that reaches checkout carries a positive unit price.
  for (const isMember of [true, false])
    for (const t of [tt({ price_cents: 0 }), tt({ member_price_cents: 0 }), tt({ member_price_cents: 900 }), tt({})]) {
      const p = planPurchase([t], { path: 'checkout', ticketTypeId: 't', isMember, qty: 1 })
      if (p.ok) assert.ok(p.unitCents > 0)
    }
})

test('a paid type cannot slip through the free path', () => {
  const r = planPurchase([tt({})], { path: 'rsvp', ticketTypeId: 't', isMember: false, qty: 1 })
  assert.deepEqual(r, { ok: false, error: 'This ticket requires checkout, not a free RSVP.' })
})

test('membership changed under the page: the wrong path reports a status change', () => {
  // Page rendered as member ($0, RSVP form) but the fresh check says not a member.
  const r = planPurchase(membersFree, { path: 'rsvp', ticketTypeId: 'mf', isMember: false, qty: 1 })
  assert.deepEqual(r, { ok: false, error: STATUS_CHANGED_MESSAGE, statusChanged: true })
  // And the reverse: rendered as guest (checkout form), now a member at $0.
  const c = planPurchase(membersFree, { path: 'checkout', ticketTypeId: 'mf', isMember: true, qty: 1 })
  assert.deepEqual(c, { ok: false, error: STATUS_CHANGED_MESSAGE, statusChanged: true })
})

test('RSVP without a posted type picks a $0-for-this-viewer type that fits the party', () => {
  const types = [
    tt({ id: 'paid' }),
    tt({ id: 'small', price_cents: 0, capacity: 1 }),
    tt({ id: 'big', price_cents: 0, capacity: 10 }),
  ]
  const r = planPurchase(types, { path: 'rsvp', isMember: false, qty: 3 })
  assert.ok(r.ok)
  assert.equal(r.ticket.id, 'big')
  assert.deepEqual(planPurchase([tt({})], { path: 'rsvp', isMember: false, qty: 1 }), {
    ok: false,
    error: 'This event requires tickets, not a free RSVP.',
  })
})

test('members-only refusal maps to the members message, not "not enough spots"', () => {
  const soldOut = 'Sorry — there aren’t enough spots left for that many guests.'
  assert.equal(reserveErrorMessage({ code: '42501', message: 'members_only' }, soldOut), MEMBERS_ONLY_MESSAGE)
  assert.equal(reserveErrorMessage({ code: 'P0001', message: 'insufficient_inventory' }, soldOut), soldOut)
  assert.equal(reserveErrorMessage({ code: '23505', message: 'dup' }, soldOut), null)
})
