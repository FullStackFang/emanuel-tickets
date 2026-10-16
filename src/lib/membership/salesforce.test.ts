// Salesforce adapter tests with recorded-shape fixtures and a fake fetch.
//   node --test --experimental-strip-types src/lib/membership/salesforce.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import {
  configFromEnv,
  createSalesforceProvider,
  soqlString,
  DEFAULT_EMAIL_FIELDS,
  type SalesforceConfig,
} from './salesforce.ts'
import { MembershipConfigError } from './provider.ts'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const STANDING = 'Member_In_Good_Standing__c'
const config: SalesforceConfig = {
  loginUrl: 'https://login.salesforce.com',
  clientId: 'cid',
  username: 'integration@temple.org',
  privateKeyPem: PEM,
  goodStandingField: STANDING,
  emailFields: DEFAULT_EMAIL_FIELDS,
  deceasedField: 'npsp__Deceased__c',
}
const NOW = new Date('2026-10-15T12:00:00Z')

type Contact = { Id: string; AccountId: string | null; npsp__Deceased__c?: boolean }

// Fixtures keyed on the SOQL FROM clause; records the queries it saw. Applies the
// deceased and household filters the way Salesforce would when the query asks.
function fakeSalesforce(opts: {
  contacts: Contact[]
  accounts?: unknown[]
  status?: number
  errorBody?: unknown
  tokenError?: unknown
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
      if (opts.tokenError) return json(opts.tokenError, 400)
      return json({ access_token: `tok${tokenCalls}`, instance_url: 'https://temple.my.salesforce.com' })
    }
    if (opts.status) return json(opts.errorBody ?? {}, opts.status)
    if (unauthorizedOnce) {
      unauthorizedOnce = false
      return json([{ errorCode: 'INVALID_SESSION_ID' }], 401)
    }
    const q = new URL(u).searchParams.get('q')!
    queries.push(q)
    if (!q.includes('FROM Contact')) return json({ records: opts.accounts ?? [] })
    const records = opts.contacts.filter(
      (c) =>
        (!q.includes('npsp__Deceased__c = false') || !c.npsp__Deceased__c) &&
        (!q.includes('AccountId != null') || c.AccountId),
    )
    return json({ records })
  }) as typeof fetch
  return { fetchImpl, queries, tokenCalls: () => tokenCalls }
}
const provider = (f: typeof fetch, cfg: SalesforceConfig = config) =>
  createSalesforceProvider({ config: () => cfg, fetch: f, now: () => NOW })

test('spouse on a dues-paying household is active with the household id', async () => {
  const sf = fakeSalesforce({
    contacts: [{ Id: '003spouse', AccountId: '001house' }],
    accounts: [{ Id: '001house', [STANDING]: true }],
  })
  const r = await provider(sf.fetchImpl).lookup({ email: ' Spouse@Example.com ' })
  assert.equal(r.status, 'active')
  assert.equal(r.externalId, '001house')
  assert.ok(sf.queries[0].includes(`'spouse@example.com'`), 'email normalized')
  assert.ok(sf.queries[1].includes(`SELECT Id, ${STANDING} FROM Account`), 'reads the one standing field')
})

test('every configured email field is queried', async () => {
  const sf = fakeSalesforce({
    contacts: [{ Id: '003alt', AccountId: '001a' }],
    accounts: [{ Id: '001a', [STANDING]: true }],
  })
  assert.equal((await provider(sf.fetchImpl).lookup({ email: 'alt@example.com' })).status, 'active')
  for (const f of DEFAULT_EMAIL_FIELDS) assert.ok(sf.queries[0].includes(`${f} = 'alt@example.com'`), f)

  const custom = fakeSalesforce({ contacts: [] })
  await provider(custom.fetchImpl, { ...config, emailFields: ['Email', 'Bulletin_Email__c'] }).lookup({
    email: 'b@example.com',
  })
  assert.ok(custom.queries[0].includes(`Bulletin_Email__c = 'b@example.com'`))
  assert.ok(!custom.queries[0].includes('npe01__WorkEmail__c'))
})

test('matched households none in good standing are lapsed, with a household id', async () => {
  const sf = fakeSalesforce({
    contacts: [
      { Id: '003a', AccountId: '001a' },
      { Id: '003b', AccountId: '001b' },
    ],
    accounts: [
      { Id: '001a', [STANDING]: false },
      { Id: '001b', [STANDING]: null },
    ],
  })
  const r = await provider(sf.fetchImpl).lookup({ email: 'x@example.com' })
  assert.deepEqual([r.status, r.externalId], ['lapsed', '001a'])
})

test('deceased contact is not_found', async () => {
  const sf = fakeSalesforce({
    contacts: [{ Id: '003gone', AccountId: '001house', npsp__Deceased__c: true }],
    accounts: [{ Id: '001house', [STANDING]: true }],
  })
  const r = await provider(sf.fetchImpl).lookup({ email: 'late@example.com' })
  assert.deepEqual([r.status, r.externalId], ['not_found', null])
  assert.ok(sf.queries[0].includes('npsp__Deceased__c = false'))
})

test('contact without a household is not_found', async () => {
  const sf = fakeSalesforce({ contacts: [{ Id: '003solo', AccountId: null }] })
  const r = await provider(sf.fetchImpl).lookup({ email: 'solo@example.com' })
  assert.deepEqual([r.status, r.externalId], ['not_found', null])
  assert.equal(sf.queries.length, 1, 'no household query')
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

test('transport failure throws a plain error (the caller backs off and uses the cache)', async () => {
  const sf = fakeSalesforce({ contacts: [], status: 503 })
  await assert.rejects(
    () => provider(sf.fetchImpl).lookup({ email: 'a@example.com' }),
    (e) => !(e instanceof MembershipConfigError),
  )
})

test('configuration errors are classified by errorCode and never carry the body', async () => {
  const badField = fakeSalesforce({
    contacts: [],
    status: 400,
    errorBody: [{ errorCode: 'INVALID_FIELD', message: "No such column 'secret@example.com'" }],
  })
  await assert.rejects(
    () => provider(badField.fetchImpl).lookup({ email: 'secret@example.com' }),
    (e) => e instanceof MembershipConfigError && e.message.includes('INVALID_FIELD') && !e.message.includes('secret'),
  )

  const badGrant = fakeSalesforce({ contacts: [], tokenError: { error: 'invalid_grant', error_description: 'x' } })
  await assert.rejects(
    () => provider(badGrant.fetchImpl).lookup({ email: 'a@example.com' }),
    (e) => e instanceof MembershipConfigError,
  )
})

test('token is cached across lookups and refreshed once on 401', async () => {
  const sf = fakeSalesforce({ contacts: [], firstQuery401: true })
  const p = provider(sf.fetchImpl)
  await p.lookup({ email: 'a@example.com' })
  await p.lookup({ email: 'b@example.com' })
  assert.equal(sf.tokenCalls(), 2, 'one initial token + one refresh after 401, none per lookup')
})

test('config from env: required standing field, identifier-only field names', () => {
  const env = {
    SF_LOGIN_URL: 'https://login.salesforce.com/',
    SF_CLIENT_ID: 'cid',
    SF_USERNAME: 'u',
    SF_PRIVATE_KEY: Buffer.from(PEM).toString('base64'),
    SF_GOOD_STANDING_FIELD: STANDING,
  }
  const cfg = configFromEnv(env)
  assert.equal(cfg.loginUrl, 'https://login.salesforce.com')
  assert.deepEqual(cfg.emailFields, DEFAULT_EMAIL_FIELDS)
  assert.equal(cfg.deceasedField, 'npsp__Deceased__c')
  assert.deepEqual(configFromEnv({ ...env, SF_EMAIL_FIELDS: 'Email, Bulletin_Email__c' }).emailFields, [
    'Email',
    'Bulletin_Email__c',
  ])
  assert.throws(() => configFromEnv({ ...env, SF_GOOD_STANDING_FIELD: '' }), MembershipConfigError)
  assert.throws(() => configFromEnv({ ...env, SF_GOOD_STANDING_FIELD: 'X__c FROM User --' }), MembershipConfigError)
  assert.throws(() => configFromEnv({ ...env, SF_EMAIL_FIELDS: 'Email,Name != null' }), MembershipConfigError)
})
