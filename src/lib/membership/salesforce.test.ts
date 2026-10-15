// Salesforce adapter tests with recorded-shape fixtures and a fake fetch.
//   node --test --experimental-strip-types src/lib/membership/salesforce.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import {
  createSalesforceProvider,
  parseFieldMap,
  soqlString,
  type SalesforceConfig,
} from './salesforce.ts'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config: SalesforceConfig = {
  loginUrl: 'https://login.salesforce.com',
  clientId: 'cid',
  username: 'integration@temple.org',
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  fieldMap: parseFieldMap(
    JSON.stringify({
      object: 'Account',
      statusField: 'Membership_Status__c',
      activeValues: ['Active'],
      endDateField: 'npo02__MembershipEndDate__c',
    }),
  ),
}
const NOW = new Date('2026-10-15T12:00:00Z')

// Fixtures keyed on the SOQL FROM clause; records the queries it saw.
function fakeSalesforce(opts: {
  contacts: unknown[]
  accounts?: unknown[]
  status?: number
  firstQuery401?: boolean
}) {
  const queries: string[] = []
  let tokenCalls = 0
  let unauthorizedOnce = !!opts.firstQuery401
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith('/services/oauth2/token')) {
      tokenCalls++
      return json({ access_token: `tok${tokenCalls}`, instance_url: 'https://temple.my.salesforce.com' })
    }
    if (opts.status) return json({}, opts.status)
    if (unauthorizedOnce) {
      unauthorizedOnce = false
      return json([{ errorCode: 'INVALID_SESSION_ID' }], 401)
    }
    const q = new URL(u).searchParams.get('q')!
    queries.push(q)
    return json({ records: q.includes('FROM Contact') ? opts.contacts : (opts.accounts ?? []) })
  }) as typeof fetch
  return { fetchImpl, queries, tokenCalls: () => tokenCalls }
}
const provider = (f: typeof fetch) =>
  createSalesforceProvider({ config: () => config, fetch: f, now: () => NOW })

test('spouse on a dues-paying household is active', async () => {
  const sf = fakeSalesforce({
    contacts: [{ Id: '003spouse', AccountId: '001house' }],
    accounts: [
      { Id: '001house', Membership_Status__c: 'Active', npo02__MembershipEndDate__c: '2027-06-30' },
    ],
  })
  const r = await provider(sf.fetchImpl).lookup({ email: ' Spouse@Example.com ' })
  assert.equal(r.status, 'active')
  assert.equal(r.externalId, '001house')
  assert.ok(sf.queries[0].includes(`'spouse@example.com'`), 'email normalized')
})

test('email in the alternate field is matched; every email field is queried', async () => {
  const sf = fakeSalesforce({
    contacts: [{ Id: '003alt', AccountId: '001a' }],
    accounts: [{ Id: '001a', Membership_Status__c: 'Active', npo02__MembershipEndDate__c: null }],
  })
  assert.equal((await provider(sf.fetchImpl).lookup({ email: 'alt@example.com' })).status, 'active')
  for (const f of ['Email', 'npe01__HomeEmail__c', 'npe01__WorkEmail__c', 'npe01__AlternateEmail__c'])
    assert.ok(sf.queries[0].includes(`${f} = 'alt@example.com'`), f)
})

test('matched but not in good standing is lapsed (status or past end date)', async () => {
  const sf = fakeSalesforce({
    contacts: [
      { Id: '003a', AccountId: '001a' },
      { Id: '003b', AccountId: '001b' },
    ],
    accounts: [
      { Id: '001a', Membership_Status__c: 'Lapsed', npo02__MembershipEndDate__c: null },
      { Id: '001b', Membership_Status__c: 'Active', npo02__MembershipEndDate__c: '2025-12-31' },
    ],
  })
  assert.equal((await provider(sf.fetchImpl).lookup({ email: 'x@example.com' })).status, 'lapsed')
})

test('zero contacts is not_found', async () => {
  const sf = fakeSalesforce({ contacts: [] })
  const r = await provider(sf.fetchImpl).lookup({ email: 'nobody@example.com' })
  assert.deepEqual([r.status, r.externalId], ['not_found', null])
})

test('hostile email is escaped so quotes and backslashes stay literal', async () => {
  const hostile = "o'brien\\@example.com" // o'brien\@example.com
  assert.equal(soqlString(hostile), "'o\\'brien\\\\@example.com'")

  const sf = fakeSalesforce({ contacts: [] })
  // Fails the email regex (whitespace) -> no query is sent at all.
  await provider(sf.fetchImpl).lookup({ email: "a' OR Name != 'x@example.com" })
  assert.equal(sf.queries.length, 0)

  await provider(sf.fetchImpl).lookup({ email: hostile })
  assert.ok(sf.queries[0].includes("Email = 'o\\'brien\\\\@example.com'"))
  assert.ok(!sf.queries[0].includes("= 'o'brien"), 'no unescaped quote')
})

test('transport failure throws (the caller applies the cached fallback)', async () => {
  const sf = fakeSalesforce({ contacts: [], status: 503 })
  await assert.rejects(() => provider(sf.fetchImpl).lookup({ email: 'a@example.com' }))
})

test('token is cached across lookups and refreshed once on 401', async () => {
  const sf = fakeSalesforce({ contacts: [], firstQuery401: true })
  const p = provider(sf.fetchImpl)
  await p.lookup({ email: 'a@example.com' })
  await p.lookup({ email: 'b@example.com' })
  assert.equal(sf.tokenCalls(), 2, 'one initial token + one refresh after 401, none per lookup')
})

test('field map rejects non-identifier field names', () => {
  assert.throws(() =>
    parseFieldMap(JSON.stringify({ statusField: 'X__c FROM User --', activeValues: ['A'] })),
  )
})
