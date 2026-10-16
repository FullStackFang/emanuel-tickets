// Verification for the member/host privilege boundary (migration
// 20261014120000_member_auth, openspec add-member-auth D1/D2/D6). Node's built-in
// test runner + `pg`.
//
//   SUPABASE_DB_URL='postgresql://...:5432/postgres' node --test supabase/tests/roles.test.mjs
//
// Every test runs inside a transaction that is rolled back, so it is safe against
// any database: no rows survive. Browser roles are simulated the way PostgREST does
// it: `set local role authenticated` plus `request.jwt.claims`.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const CONN = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const pool = new pg.Pool({ connectionString: CONN, max: 5 })
after(() => pool.end())

// Run fn(client, ids) in a rolled-back transaction with a member user M (no Microsoft
// identity) and a host user H (azure identity), plus a draft event owned by M that
// has a ticket type, an order, and a membership row.
async function inTx(fn) {
  const c = await pool.connect()
  const ids = { m: randomUUID(), h: randomUUID() }
  try {
    await c.query('begin')
    await c.query(`insert into auth.users (id, email) values ($1, $3), ($2, $4)`, [
      ids.m, ids.h, `m-${ids.m}@example.invalid`, `h-${ids.h}@example.invalid`,
    ])
    await c.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider)
       values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text), 'azure')`,
      [ids.h],
    )
    ids.ev = (await c.query(
      `insert into public.events (host_id, title, status) values ($1, 'draft', 'draft') returning id`,
      [ids.m],
    )).rows[0].id
    ids.tt = (await c.query(
      `insert into public.ticket_types (event_id, name, price_cents, capacity) values ($1, 'GA', 0, 5) returning id`,
      [ids.ev],
    )).rows[0].id
    ids.order = (await c.query(
      `insert into public.orders (event_id, ticket_type_id, qty, buyer_email, amount_cents)
       values ($1, $2, 1, 'x@example.invalid', 1500) returning id`,
      [ids.ev, ids.tt],
    )).rows[0].id
    await c.query(
      `insert into public.memberships values ($1, 'fake', null, 'active', now(), now() + interval '1 day')`,
      [ids.m],
    )
    await fn(c, ids)
  } finally {
    await c.query('rollback')
    c.release()
  }
}

async function as(c, userId, appRole) {
  await c.query(`set local role authenticated`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', app_metadata: { app_role: appRole } }),
  ])
}
const count = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n)

// Savepoint-wrapped expectation that a statement is refused with SQLSTATE `code`.
async function rejects(c, sql, params, code) {
  await c.query('savepoint s')
  await assert.rejects(() => c.query(sql, params), (e) => e.code === code)
  await c.query('rollback to savepoint s')
}

test('attendee session: no event writes, no drafts, no orders/attendees/memberships', async () => {
  await inTx(async (c, { m, ev }) => {
    await as(c, m, 'attendee')
    await rejects(c, `insert into public.events (host_id, title) values ($1, 'x')`, [m], '42501')
    assert.equal(await count(c, `select count(*) n from public.events where id = $1`, [ev]), 0)
    assert.equal(await count(c, `select count(*) n from public.orders where event_id = $1`, [ev]), 0)
    assert.equal(await count(c, `select count(*) n from public.attendees where event_id = $1`, [ev]), 0)
    assert.equal(await count(c, `select count(*) n from public.memberships`), 0)
    await rejects(
      c,
      `insert into public.memberships values ($1, 'x', null, 'active', now(), now())`,
      [m],
      '42501',
    )
    await rejects(c, `select public.reserve_seat(gen_random_uuid(), 1)`, [], '42501')
  })
})

test('host session: create and read own draft events and ticket types', async () => {
  await inTx(async (c, { h }) => {
    await as(c, h, 'host')
    const ev = (await c.query(
      `insert into public.events (host_id, title) values ($1, 'mine') returning id`,
      [h],
    )).rows[0].id
    await c.query(`insert into public.ticket_types (event_id, name, capacity) values ($1, 'GA', 3)`, [ev])
    assert.equal(await count(c, `select count(*) n from public.events where id = $1`, [ev]), 1)
    assert.equal(await count(c, `select count(*) n from public.ticket_types where event_id = $1`, [ev]), 1)
  })
})

test('access token hook: role from amr, staff refused off Microsoft', async () => {
  await inTx(async (c, { m, h }) => {
    const hook = async (userId, method) =>
      (await c.query(`select public.custom_access_token_hook($1::jsonb) r`, [
        JSON.stringify({
          user_id: userId,
          authentication_method: method,
          claims: { amr: [{ method: method === 'token_refresh' ? 'oauth' : method, timestamp: 0 }], app_metadata: {} },
        }),
      ])).rows[0].r
    assert.equal((await hook(h, 'oauth')).claims.app_metadata.app_role, 'host')
    assert.equal((await hook(m, 'otp')).claims.app_metadata.app_role, 'attendee')
    for (const method of ['otp', 'recovery', 'password'])
      assert.equal((await hook(h, method)).error.http_code, 403, method)
    assert.equal((await hook(h, 'token_refresh')).claims.app_metadata.app_role, 'host')
  })
})

test('a later membership change does not alter a pending order amount', async () => {
  await inTx(async (c, { m, order }) => {
    await c.query(`update public.memberships set status = 'lapsed' where user_id = $1`, [m])
    const { rows } = await c.query(`select amount_cents from public.orders where id = $1`, [order])
    assert.equal(rows[0].amount_cents, 1500)
  })
})
