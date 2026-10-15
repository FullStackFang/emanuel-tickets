// Unit tests for the membership seam and verifier: no network, no DB.
//   node --test --experimental-strip-types src/lib/membership/membership.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeMembershipProvider } from './fake.ts'
import { membershipVerifier, RECHECK_MS, type MembershipRow, type MembershipStore } from './verify.ts'
import type { MembershipProvider } from './provider.ts'

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

const viewer = { userId: 'u1', email: 'member@example.com', role: 'member' as const }
const row = (status: MembershipRow['status'], expiresInMs: number): MembershipRow => ({
  user_id: 'u1',
  provider: 'fake',
  external_id: 'x',
  status,
  verified_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + expiresInMs).toISOString(),
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

test('verifyMembership stores the result with a 24h re-check time', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = 'member@example.com'
  const { store, rows } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => fakeMembershipProvider })
  assert.equal(await v.verifyMembership('u1', 'member@example.com'), 'active')
  const r = rows.get('u1')!
  assert.equal(r.status, 'active')
  assert.equal(new Date(r.expires_at).getTime() - new Date(r.verified_at).getTime(), RECHECK_MS)
})

test('fresh cache is reused without a provider call; stale cache is re-checked', async () => {
  process.env.MEMBERSHIP_FAKE_ACTIVE = ''
  const fresh = memoryStore([row('active', 60_000)])
  const c1 = counting(fakeMembershipProvider)
  assert.deepEqual(
    await membershipVerifier({ store: fresh.store, provider: c1.provider }).ensureFreshMembership(viewer),
    { isMember: true },
  )
  assert.equal(c1.calls(), 0)

  const stale = memoryStore([row('active', -1)])
  const c2 = counting(fakeMembershipProvider)
  assert.deepEqual(
    await membershipVerifier({ store: stale.store, provider: c2.provider }).ensureFreshMembership(viewer),
    { isMember: false }, // the fake now says not_found
  )
  assert.ok(c2.calls() >= 1)
  assert.equal(stale.rows.get('u1')!.status, 'not_found', 'stored result replaced')
})

test('provider failure with a cached row keeps the cached status and leaves the row', async () => {
  const cached = row('active', -1) // stale, so a re-check is attempted
  const { store, rows } = memoryStore([cached])
  const v = membershipVerifier({ store, provider: async () => failing, budgetMs: 200 })
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: true })
  assert.deepEqual(rows.get('u1'), cached)
})

test('provider failure without a cache yields non-member and does not throw', async () => {
  const { store, rows } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => failing, budgetMs: 200 })
  assert.equal(await v.verifyMembership('u1', 'member@example.com'), 'not_found')
  assert.deepEqual(await v.ensureFreshMembership(viewer), { isMember: false })
  assert.equal(rows.size, 0)
})

test('the total budget bounds a hanging provider, retry included', async () => {
  const hanging: MembershipProvider = { id: 'hang', lookup: () => new Promise(() => {}) }
  const { store } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => hanging, budgetMs: 150 })
  const t0 = Date.now()
  assert.equal(await v.verifyMembership('u1', 'member@example.com'), 'not_found')
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 400, `took ${elapsed}ms`)
})

test('signed-out viewer is never a member', async () => {
  const { store } = memoryStore()
  const v = membershipVerifier({ store, provider: async () => fakeMembershipProvider })
  assert.deepEqual(await v.ensureFreshMembership(null), { isMember: false })
})
