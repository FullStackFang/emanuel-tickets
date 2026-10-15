// Verification for the ticketing core (design D1–D5). Node's built-in test runner + `pg`.
//
//   Run against LOCAL Supabase (no secrets):
//     supabase db start && supabase db reset      # applies migrations
//     node --test supabase/tests/reserve_seat.test.mjs
//
//   Run against a remote/other DB:
//     SUPABASE_DB_URL='postgresql://...:5432/postgres' node --test supabase/tests/reserve_seat.test.mjs
//
// Requires the `pg` dev dependency (npm i -D pg). Connects as the superuser so it can
// seed auth.users and call the SECURITY DEFINER functions directly.

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const CONN = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const pool = new pg.Pool({ connectionString: CONN, max: 40 })

const HOST_ID = '00000000-0000-0000-0000-0000000000aa'

before(async () => {
  // Minimal auth user to satisfy events.host_id FK.
  await pool.query(
    `insert into auth.users (id, email) values ($1, 'host@example.com')
     on conflict (id) do nothing`,
    [HOST_ID],
  )
})

after(async () => {
  await pool.query(`delete from auth.users where id = $1`, [HOST_ID])
  await pool.end()
})

// Fresh event + one ticket type of the given capacity; returns their ids.
async function seedEvent(capacity, priceCents = 1000) {
  const ev = await pool.query(
    `insert into public.events (host_id, title, status) values ($1, 'Test Event', 'published') returning id`,
    [HOST_ID],
  )
  const eventId = ev.rows[0].id
  const tt = await pool.query(
    `insert into public.ticket_types (event_id, name, price_cents, capacity)
     values ($1, 'GA', $2, $3) returning id`,
    [eventId, priceCents, capacity],
  )
  return { eventId, ticketTypeId: tt.rows[0].id }
}

beforeEach(async () => {
  // Isolate tests: clear rows but keep the shared host user.
  await pool.query(`delete from public.events where host_id = $1`, [HOST_ID])
})

test('concurrent buyers cannot oversell the last seat', async () => {
  const { ticketTypeId } = await seedEvent(1) // exactly one seat

  const attempts = 25
  const results = await Promise.allSettled(
    Array.from({ length: attempts }, () =>
      pool.query('select id from public.reserve_seat($1, 1)', [ticketTypeId]),
    ),
  )

  const ok = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter(
    (r) => r.status === 'rejected' && /insufficient_inventory/.test(r.reason.message),
  ).length

  assert.equal(ok, 1, 'exactly one reservation should succeed')
  assert.equal(failed, attempts - 1, 'all others fail with insufficient_inventory')

  const { rows } = await pool.query(
    'select sold, held, capacity from public.ticket_types where id = $1',
    [ticketTypeId],
  )
  const { sold, held, capacity } = rows[0]
  assert.ok(sold + held <= capacity, 'capacity invariant holds')
  assert.equal(held, 1)
})

test('reservation for more than available fails and leaves inventory untouched', async () => {
  const { ticketTypeId } = await seedEvent(3)
  await assert.rejects(
    () => pool.query('select id from public.reserve_seat($1, 4)', [ticketTypeId]),
    /insufficient_inventory/,
  )
  const { rows } = await pool.query('select held from public.ticket_types where id = $1', [ticketTypeId])
  assert.equal(rows[0].held, 0)
})

test('confirm_order commits held seats to sold and is idempotent', async () => {
  const { eventId, ticketTypeId } = await seedEvent(10)
  const res = await pool.query('select id from public.reserve_seat($1, 2)', [ticketTypeId])
  const reservationId = res.rows[0].id

  const ord = await pool.query(
    `insert into public.orders (event_id, reservation_id, ticket_type_id, qty, buyer_email, amount_cents)
     values ($1, $2, $3, 2, 'buyer@example.com', 2000) returning id`,
    [eventId, reservationId, ticketTypeId],
  )
  const orderId = ord.rows[0].id

  await pool.query('select public.confirm_order($1, $2)', [orderId, 'evt_1'])
  // Duplicate delivery of the same provider event: must be a no-op.
  await pool.query('select public.confirm_order($1, $2)', [orderId, 'evt_1'])

  const tt = await pool.query('select sold, held from public.ticket_types where id = $1', [ticketTypeId])
  assert.equal(tt.rows[0].sold, 2, 'sold incremented exactly once')
  assert.equal(tt.rows[0].held, 0, 'hold released exactly once')

  const at = await pool.query('select count(*)::int as n from public.attendees where order_id = $1', [orderId])
  assert.equal(at.rows[0].n, 2, 'one attendee row per seat, not doubled')

  const o = await pool.query('select status, needs_refund from public.orders where id = $1', [orderId])
  assert.equal(o.rows[0].status, 'confirmed')
  assert.equal(o.rows[0].needs_refund, false)
})

test('expiry sweep returns seats and expires the pending order', async () => {
  const { eventId, ticketTypeId } = await seedEvent(5)
  // Hold that is already expired.
  const res = await pool.query('select id from public.reserve_seat($1, 2, -1)', [ticketTypeId])
  const reservationId = res.rows[0].id
  await pool.query(
    `insert into public.orders (event_id, reservation_id, ticket_type_id, qty, buyer_email)
     values ($1, $2, $3, 2, 'late@example.com')`,
    [eventId, reservationId, ticketTypeId],
  )

  const swept = await pool.query('select public.release_expired_reservations() as n')
  assert.ok(swept.rows[0].n >= 1)

  const tt = await pool.query('select held from public.ticket_types where id = $1', [ticketTypeId])
  assert.equal(tt.rows[0].held, 0, 'seats returned to inventory')
  const o = await pool.query('select status from public.orders where reservation_id = $1', [reservationId])
  assert.equal(o.rows[0].status, 'expired')
})

test('late payment after resale is flagged needs_refund, never oversold', async () => {
  const { eventId, ticketTypeId } = await seedEvent(1)
  // Buyer A holds the only seat, then it expires and is swept.
  const a = await pool.query('select id from public.reserve_seat($1, 1, -1)', [ticketTypeId])
  const orderA = await pool.query(
    `insert into public.orders (event_id, reservation_id, ticket_type_id, qty, buyer_email)
     values ($1, $2, $3, 1, 'a@example.com') returning id`,
    [eventId, a.rows[0].id, ticketTypeId],
  )
  await pool.query('select public.release_expired_reservations()')

  // Buyer B grabs and confirms the resold seat.
  const b = await pool.query('select id from public.reserve_seat($1, 1)', [ticketTypeId])
  const orderB = await pool.query(
    `insert into public.orders (event_id, reservation_id, ticket_type_id, qty, buyer_email)
     values ($1, $2, $3, 1, 'b@example.com') returning id`,
    [eventId, b.rows[0].id, ticketTypeId],
  )
  await pool.query('select public.confirm_order($1, $2)', [orderB.rows[0].id, 'evt_b'])

  // A's payment lands late: no seat left to commit.
  await pool.query('select public.confirm_order($1, $2)', [orderA.rows[0].id, 'evt_a'])

  const tt = await pool.query('select sold, held, capacity from public.ticket_types where id = $1', [ticketTypeId])
  assert.ok(tt.rows[0].sold + tt.rows[0].held <= tt.rows[0].capacity, 'no oversell')
  assert.equal(tt.rows[0].sold, 1)

  const oa = await pool.query('select status, needs_refund from public.orders where id = $1', [orderA.rows[0].id])
  assert.equal(oa.rows[0].needs_refund, true, "late order flagged for refund")
})

// --- members-only assertion (migration 20261014120000_member_auth) -----------

test('existing 2- and 3-argument calls still resolve to the 4-argument function', async () => {
  const { ticketTypeId } = await seedEvent(5)
  await pool.query('select id from public.reserve_seat($1, 1)', [ticketTypeId])
  await pool.query('select id from public.reserve_seat($1, 1, 15)', [ticketTypeId])
  const { rows } = await pool.query('select held from public.ticket_types where id = $1', [ticketTypeId])
  assert.equal(rows[0].held, 2)
})

test('members-only refuses non-members with 42501 and leaves inventory untouched', async () => {
  const { ticketTypeId } = await seedEvent(5)
  await pool.query('update public.ticket_types set members_only = true where id = $1', [ticketTypeId])

  for (const sql of [
    'select id from public.reserve_seat($1, 1)',
    'select id from public.reserve_seat($1, 1, 15)',
    'select id from public.reserve_seat($1, 1, 15, false)',
  ])
    await assert.rejects(() => pool.query(sql, [ticketTypeId]), (e) => e.code === '42501', sql)

  let { rows } = await pool.query('select held from public.ticket_types where id = $1', [ticketTypeId])
  assert.equal(rows[0].held, 0, 'refusals do not touch inventory')

  await pool.query('select id from public.reserve_seat($1, 2, 15, true)', [ticketTypeId])
  ;({ rows } = await pool.query('select held from public.ticket_types where id = $1', [ticketTypeId]))
  assert.equal(rows[0].held, 2)
})

test('members-only still enforces capacity for members', async () => {
  const { ticketTypeId } = await seedEvent(1)
  await pool.query('update public.ticket_types set members_only = true where id = $1', [ticketTypeId])
  await assert.rejects(
    () => pool.query('select id from public.reserve_seat($1, 2, 15, true)', [ticketTypeId]),
    (e) => e.code === 'P0001',
  )
})
