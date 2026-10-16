// Unit tests for the membership seam and verifier: no network, no DB.
//   node --test --experimental-strip-types src/lib/membership/membership.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeMembershipProvider } from './fake.ts'
import {
  membershipVerifier,
  membershipDisplay,
  emailSha256,
  ACTIVE_TTL_MS,
  OTHER_TTL_MS,
  BACKOFF_MS,
  type MembershipRow,
  type MembershipStore,
} from './verify.ts'
import { MembershipConfigError, type MembershipProvider } from './provider.ts'

const EMAIL = 'member@example.com'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function memoryStore(initial: MembershipRow[] = []) {
  const rows = new Map(initial.map((r) => [r.user_id, r]))
  const store: MembershipStore = {
    async get(id) {
      return rows.get(id) ?? null
    },
    async put(row) {
      rows.set(row.user_id, row)
    },
  }
  return { store, rows }
}

// A clock the test can move.
function clock(start = new Date('2026-10-15T12:00:00Z')) {
  let t = start.getTime()
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) }
}

const viewer = { userId: 'u1', email: EMAIL, role: 'attendee' as const }
// A row verified `ageMs` before `at`, due for re-check `expiresInMs` after `at`.
const row = (
  status: MembershipRow['status'],
  {
    at = new Date(),
    ageMs = 0,
    expiresInMs = HOUR,
    email = EMAIL,
    retryAfter = null,
  }: { at?: Date; ageMs?: number; expiresInMs?: number; email?: string; retryAfter?: string | null } = {},
): MembershipRow => ({
  user_id: 'u1',
  provider: 'fake',
  external_id: 'x',
  status,
  verified_at: new Date(at.getTime() - ageMs).toISOString(),
  expires_at: new Date(at.getTime() + expiresInMs).toISOString(),
  retry_after: retryAfter,
  email_sha256: emailSha256(email),
})
const counting = (p: MembershipProvider) => {
  let calls = 0
  return {
    provider: async () => {
      calls++
      return p
    },
    calls: () => calls,
  }
}
// Counts lookups (the actual CRM calls), not provider resolutions.
const lookups = (p: MembershipProvider) => {
  let n = 0
  const provider: MembershipProvider = {
    id: p.id,
    lookup: (input) => {
      n++
      return p.lookup(input)
    },
  }
  return { provider, count: () => n }
}
const failing: MembershipProvider = {
  id: 'down',
  lookup: async () => {
    throw new Error('CRM down')
  },
}

test('fake provider yields each status from its env lists', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = 'a@example.com, Upper@Example.com'
  process.env.MEMBERSHIP_FAKE_LAPSED = 'l@example.com'
  assert.equal((await fakeMembershipProvider.lookup({ email: 'a@example.com' })).status, 'active')
  assert.equal((await fakeMembershipProvider.lookup({ email: ' upper@example.com ' })).status, 'active')
  assert.equal((await fakeMembershipProvider.lookup({ email: 'l@example.com' })).status, 'lapsed')
  const nf = await fakeMembershipProvider.lookup({ email: 'other@example.com' })
  assert.equal(nf.status, 'not_found')
  assert.equal(nf.externalId, null)
})

test('active results are kept 24 h, lapsed and not_found 1 h; the email hash is stored', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = EMAIL
  process.env.MEMBERSHIP_FAKE_LAPSED = 'l@example.com'
  const { store, rows } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => fakeMembershipProvider })
  const ttl = (r: MembershipRow) => new Date(r.expires_at).getTime() - new Date(r.verified_at).getTime()

  assert.equal(await v.verifyMembership('u1', EMAIL), 'active')
  assert.equal(ttl(rows.get('u1')!), ACTIVE_TTL_MS)
  assert.equal(rows.get('u1')!.email_sha256, emailSha256(EMAIL))
  assert.equal(rows.get('u1')!.retry_after, null)

  assert.equal(await v.verifyMembership('u1', 'l@example.com'), 'lapsed')
  assert.equal(ttl(rows.get('u1')!), OTHER_TTL_MS)
  assert.equal(await v.verifyMembership('u1', 'nobody@example.com'), 'not_found')
  assert.equal(ttl(rows.get('u1')!), OTHER_TTL_MS)
})

test('fresh result is reused without a provider call; stale result is re-checked', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = ''
  const fresh = memoryStore([row('active', { expiresInMs: MIN })])
  const c1 = counting(fakeMembershipProvider)
  assert.deepEqual(
    await membershipVerifier({ store: fresh.store, provider: c1.provider }).ensureFreshMembership(viewer),
    { isMember: true },
  )
  assert.equal(c1.calls(), 0)

  const stale = memoryStore([row('active', { expiresInMs: -1 })])
  const c2 = counting(fakeMembershipProvider)
  assert.deepEqual(
    await membershipVerifier({ store: stale.store, provider: c2.provider }).ensureFreshMembership(viewer),
    { isMember: false }, // the fake now says not_found
  )
  assert.ok(c2.calls() >= 1)
  assert.equal(stale.rows.get('u1')!.status, 'not_found', 'stored result replaced')
})

test('a not_found result is re-checked after 1 hour', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = EMAIL // the office fixed the record
  const c = clock()
  const { store } = memoryStore([row('not_found', { at: c.now(), expiresInMs: OTHER_TTL_MS })])
  const l = lookups(fakeMembershipProvider)
  const v = membershipVerifier({ store, provider: async () => l.provider, now: c.now })
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: false })
  assert.equal(l.count(), 0)
  c.advance(OTHER_TTL_MS + 1)
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: true })
  assert.equal(l.count(), 1)
})

test('a result stored for a different email is never reused', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = ''
  const { store, rows } = memoryStore([row('active', { email: 'spouse@example.com', expiresInMs: DAY })])
  const l = lookups(fakeMembershipProvider)
  const v = membershipVerifier({ store, provider: async () => l.provider })
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: false })
  assert.equal(l.count(), 1)
  assert.equal(rows.get('u1')!.email_sha256, emailSha256(EMAIL))
})

test('outage with a cached active result within 7 days keeps the member; back-off is set', async () => {
  const c = clock()
  const cached = row('active', { at: c.now(), ageMs: 3 * DAY, expiresInMs: -1 })
  const { store, rows } = memoryStore([cached])
  const v = membershipVerifier({ store, provider: async () => failing, now: c.now, budgetMs: 200 })
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: true })
  const after = rows.get('u1')!
  assert.equal(after.status, 'active')
  assert.equal(after.verified_at, cached.verified_at, 'verification time untouched')
  assert.equal(new Date(after.retry_after!).getTime(), c.now().getTime() + BACKOFF_MS)
})

test('outage with a cached active result older than 7 days is a non-member, shown as unknown', async () => {
  const c = clock()
  const { store, rows } = memoryStore([row('active', { at: c.now(), ageMs: 8 * DAY, expiresInMs: -1 })])
  const v = membershipVerifier({ store, provider: async () => failing, now: c.now, budgetMs: 200 })
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: false })
  assert.equal(membershipDisplay(rows.get('u1')!, EMAIL, c.now()), 'unknown')
})

test('outage with nothing cached: non-member, unknown row with back-off, no mismatch', async () => {
  const c = clock()
  const { store, rows } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => failing, now: c.now, budgetMs: 200 })
  assert.equal(await v.verifyMembership('u1', EMAIL), 'unknown')
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: false })
  const r = rows.get('u1')!
  assert.equal(r.status, 'unknown')
  assert.ok(new Date(r.retry_after!) > c.now())
  assert.equal(membershipDisplay(r, EMAIL, c.now()), 'unknown')
})

test('two purchase attempts a minute apart during an outage make one provider call', async () => {
  const c = clock()
  const { store } = memoryStore([row('active', { at: c.now(), ageMs: DAY, expiresInMs: -1 })])
  const l = lookups(failing)
  const v = membershipVerifier({ store, provider: async () => l.provider, now: c.now, budgetMs: 200 })
  await v.ensureFreshMembership(viewer)
  const first = l.count() // the first attempt (and its in-budget retry)
  assert.ok(first >= 1)
  c.advance(MIN)
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: true })
  assert.equal(l.count(), first, 'no provider call during the back-off')
  c.advance(BACKOFF_MS)
  await v.ensureFreshMembership(viewer)
  assert.ok(l.count() > first, 'back-off over: the provider is tried again')
})

test('Check again ignores the back-off but runs at most once per 2 minutes', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = EMAIL
  const c = clock()
  const backingOff = new Date(c.now().getTime() + BACKOFF_MS).toISOString()
  const { store, rows } = memoryStore([
    row('not_found', { at: c.now(), ageMs: 10 * MIN, expiresInMs: HOUR, retryAfter: backingOff }),
  ])
  const l = lookups(fakeMembershipProvider)
  const v = membershipVerifier({ store, provider: async () => l.provider, now: c.now })

  assert.deepEqual(await v.checkAgain(viewer), { status: 'active', limited: false })
  assert.equal(l.count(), 1)
  assert.equal(rows.get('u1')!.retry_after, null, 'success clears the back-off')

  c.advance(MIN)
  assert.deepEqual(await v.checkAgain(viewer), { status: 'active', limited: true })
  assert.equal(l.count(), 1)
  c.advance(MIN + 1)
  assert.equal((await v.checkAgain(viewer)).limited, false)
  assert.equal(l.count(), 2)
})

test('an empty email skips verification entirely', async () => {
  const { store, rows } = memoryStore()
  const c1 = counting(fakeMembershipProvider)
  const v = membershipVerifier({ store, provider: c1.provider })
  assert.equal(await v.verifyMembership('u1', '  '), 'unknown')
  assert.equal(c1.calls(), 0)
  assert.equal(rows.size, 0)
})

test('a configuration error fails fast without a retry', async () => {
  let n = 0
  const misconfigured: MembershipProvider = {
    id: 'bad',
    lookup: async () => {
      n++
      throw new MembershipConfigError('salesforce: INVALID_FIELD')
    },
  }
  const { store } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => misconfigured, budgetMs: 5000 })
  assert.equal(await v.verifyMembership('u1', EMAIL), 'unknown')
  assert.equal(n, 1)
})

test('the total budget bounds a hanging provider, retry included', async () => {
  const hanging: MembershipProvider = { id: 'hang', lookup: () => new Promise(() => {}) }
  const { store } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => hanging, budgetMs: 150 })
  const t0 = Date.now()
  assert.equal(await v.verifyMembership('u1', EMAIL), 'unknown')
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 400, `took ${elapsed}ms`)
})

test('signed-out viewer is never a member', async () => {
  const { store } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => fakeMembershipProvider })
  assert.deepEqual(await v.ensureFreshMembership(null), { isMember: false })
})
