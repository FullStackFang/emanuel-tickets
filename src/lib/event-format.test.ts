// Member pricing in the pure display helpers: no network, no DB.
//   node --test --experimental-strip-types src/lib/event-format.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePriceCents, viewOf, type EventRecord, type TicketType } from './event-format.ts'

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
const event = (types: TicketType[]): EventRecord => ({
  id: 'e',
  title: 'Shabbat dinner',
  description: null,
  location: null,
  starts_at: '2099-01-01T00:00:00Z',
  status: 'published',
  category: null,
  group_slug: null,
  ticket_types: types,
})

test('effectivePriceCents: member price set, unset, and zero; guest vs member', () => {
  assert.equal(effectivePriceCents(tt({ member_price_cents: 1500 }), true), 1500)
  assert.equal(effectivePriceCents(tt({ member_price_cents: 1500 }), false), 2500)
  assert.equal(effectivePriceCents(tt({ member_price_cents: null }), true), 2500)
  assert.equal(effectivePriceCents(tt({ member_price_cents: 0 }), true), 0, 'zero is a real member price')
  assert.equal(effectivePriceCents(tt({ member_price_cents: 0 }), false), 2500)
})

test('viewOf prices for the viewer: members free, guests $25', () => {
  const e = event([tt({ member_price_cents: 0 })])
  const guest = viewOf(e)
  assert.equal(guest.isFree, false)
  assert.equal(guest.minPriceCents, 2500)
  const member = viewOf(e, { isMember: true })
  assert.equal(member.isFree, true)
  assert.equal(member.purchasableTypes[0].effectivePriceCents, 0)
  assert.equal(member.purchasableTypes[0].regularPriceCents, 2500)
})

test('members-only types and seats are hidden from non-members', () => {
  const e = event([
    tt({ id: 'ga', capacity: 5, sold: 5 }),
    tt({ id: 'mo', members_only: true, capacity: 8, sold: 2 }),
  ])
  const guest = viewOf(e)
  assert.deepEqual(guest.purchasableTypes.map((t) => t.id), ['ga'])
  assert.equal(guest.availableSeats, 0)
  assert.equal(guest.capacity, 5)
  assert.equal(guest.status, 'sold_out')

  const member = viewOf(e, { isMember: true })
  assert.deepEqual(member.purchasableTypes.map((t) => t.id), ['ga', 'mo'])
  assert.equal(member.availableSeats, 6)
  assert.equal(member.status, 'available')
})

test('viewOf still honors an injected clock', () => {
  const e = event([tt({})])
  assert.equal(viewOf(e, { now: new Date('2100-01-01') }).hasEnded, true)
  assert.equal(viewOf(e, { now: new Date('2000-01-01') }).hasEnded, false)
})
