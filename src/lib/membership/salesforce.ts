// Salesforce (NPSP) membership provider (openspec add-member-auth, design D7).
// SERVER-ONLY.
//
// Auth: OAuth 2.0 JWT bearer flow against a Connected App with a dedicated
// integration user. The access token is cached in module scope and refreshed once
// when Salesforce answers 401 (nonprofit editions have low daily API limits).
//
// Match: the normalized email against every NPSP contact email field, then
// standing is evaluated per household (Contact.AccountId) using
// SF_MEMBERSHIP_FIELD_MAP, because which field means "in good standing" is a
// temple configuration decision:
//
//   {"object":"Account","accountField":"Id","statusField":"Membership_Status__c",
//    "activeValues":["Active"],"endDateField":"npo02__MembershipEndDate__c",
//    "nullEndDateIsCurrent":true}
//
// Env: SF_LOGIN_URL, SF_CLIENT_ID, SF_USERNAME, SF_PRIVATE_KEY (base64 PEM),
// SF_MEMBERSHIP_FIELD_MAP.

import { createSign } from 'node:crypto'
import type { MembershipProvider, MembershipResult } from './provider.ts'

const API_VERSION = 'v60.0'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // same rule the RSVP/checkout forms use
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const EMAIL_FIELDS = ['Email', 'npe01__HomeEmail__c', 'npe01__WorkEmail__c', 'npe01__AlternateEmail__c']

export type FieldMap = {
  object: string
  accountField: string
  statusField: string
  activeValues: string[]
  endDateField?: string
  nullEndDateIsCurrent: boolean
}

export type SalesforceConfig = {
  loginUrl: string
  clientId: string
  username: string
  privateKeyPem: string
  fieldMap: FieldMap
}

type Fetch = typeof fetch
type Token = { accessToken: string; instanceUrl: string }

// SOQL string literal: backslash and single quote are the characters that can
// break out of '...'. Escape backslash first so the quote escape is not doubled.
export function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function parseFieldMap(raw: string | undefined): FieldMap {
  if (!raw) throw new Error('SF_MEMBERSHIP_FIELD_MAP is not set')
  const m = JSON.parse(raw) as Partial<FieldMap>
  const map: FieldMap = {
    object: m.object ?? 'Account',
    accountField: m.accountField ?? 'Id',
    statusField: m.statusField ?? '',
    activeValues: m.activeValues ?? [],
    endDateField: m.endDateField || undefined,
    nullEndDateIsCurrent: m.nullEndDateIsCurrent ?? true,
  }
  // Field names are interpolated into SOQL, so they must be plain identifiers.
  for (const f of [map.object, map.accountField, map.statusField, map.endDateField].filter(Boolean))
    if (!IDENT_RE.test(f as string)) throw new Error(`SF_MEMBERSHIP_FIELD_MAP: invalid field name ${f}`)
  if (map.activeValues.length === 0) throw new Error('SF_MEMBERSHIP_FIELD_MAP: activeValues is empty')
  return map
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SalesforceConfig {
  const need = (k: string) => {
    const v = env[k]?.trim()
    if (!v) throw new Error(`${k} is not set`)
    return v
  }
  return {
    loginUrl: need('SF_LOGIN_URL').replace(/\/+$/, ''),
    clientId: need('SF_CLIENT_ID'),
    username: need('SF_USERNAME'),
    privateKeyPem: Buffer.from(need('SF_PRIVATE_KEY'), 'base64').toString('utf8'),
    fieldMap: parseFieldMap(env.SF_MEMBERSHIP_FIELD_MAP),
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

function jwtAssertion(cfg: SalesforceConfig, nowMs: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256' }))
  const claims = b64url(
    JSON.stringify({
      iss: cfg.clientId,
      sub: cfg.username,
      aud: cfg.loginUrl,
      exp: Math.floor(nowMs / 1000) + 180,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${signer.sign(cfg.privateKeyPem).toString('base64url')}`
}

class UnauthorizedError extends Error {}

export function createSalesforceProvider(opts: {
  config: () => SalesforceConfig
  fetch?: Fetch
  now?: () => Date
}): MembershipProvider {
  const doFetch = opts.fetch ?? fetch
  const now = opts.now ?? (() => new Date())
  let token: Token | null = null // module-scope cache: one token per cold start

  async function getToken(cfg: SalesforceConfig): Promise<Token> {
    if (token) return token
    const res = await doFetch(`${cfg.loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtAssertion(cfg, now().getTime()),
      }),
    })
    if (!res.ok) throw new Error(`salesforce token request failed: ${res.status}`)
    const body = (await res.json()) as { access_token: string; instance_url: string }
    token = { accessToken: body.access_token, instanceUrl: body.instance_url }
    return token
  }

  async function query<T>(cfg: SalesforceConfig, soql: string): Promise<T[]> {
    const run = async () => {
      const t = await getToken(cfg)
      const res = await doFetch(
        `${t.instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
        { headers: { authorization: `Bearer ${t.accessToken}` } },
      )
      if (res.status === 401) throw new UnauthorizedError()
      if (!res.ok) throw new Error(`salesforce query failed: ${res.status}`)
      return ((await res.json()) as { records: T[] }).records
    }
    try {
      return await run()
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err
      token = null // expired or revoked: refresh once
      return run()
    }
  }

  return {
    id: 'salesforce',
    async lookup({ email }): Promise<MembershipResult> {
      const cfg = opts.config()
      const checkedAt = now()
      const normalized = email.trim().toLowerCase()
      if (!EMAIL_RE.test(normalized)) return { status: 'not_found', externalId: null, checkedAt }

      const lit = soqlString(normalized)
      const contacts = await query<{ Id: string; AccountId: string | null }>(
        cfg,
        `SELECT Id, AccountId FROM Contact WHERE ${EMAIL_FIELDS.map((f) => `${f} = ${lit}`).join(' OR ')}`,
      )
      if (contacts.length === 0) return { status: 'not_found', externalId: null, checkedAt }

      const accountIds = [...new Set(contacts.map((c) => c.AccountId).filter((a): a is string => !!a))]
      if (accountIds.length === 0) return { status: 'lapsed', externalId: contacts[0].Id, checkedAt }

      const m = cfg.fieldMap
      const fields = [m.accountField, m.statusField, m.endDateField].filter(Boolean)
      const records = await query<Record<string, unknown>>(
        cfg,
        `SELECT ${[...new Set(fields)].join(', ')} FROM ${m.object} WHERE ${m.accountField} IN (${accountIds.map(soqlString).join(', ')})`,
      )
      const today = checkedAt.toISOString().slice(0, 10)
      const activeRecord = records.find((r) => {
        if (!m.activeValues.includes(String(r[m.statusField] ?? ''))) return false
        if (!m.endDateField) return true
        const end = r[m.endDateField] as string | null | undefined
        return end ? end >= today : m.nullEndDateIsCurrent
      })
      if (activeRecord)
        return { status: 'active', externalId: String(activeRecord[m.accountField]), checkedAt }
      return { status: 'lapsed', externalId: accountIds[0], checkedAt }
    },
  }
}

export const salesforceMembershipProvider = createSalesforceProvider({ config: () => configFromEnv() })
