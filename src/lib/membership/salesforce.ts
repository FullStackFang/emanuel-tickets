// Salesforce (NPSP) membership provider (openspec add-member-auth D7,
// launch-member-signin D4). SERVER-ONLY.
//
// Auth: OAuth 2.0 JWT bearer flow against an External Client App with a dedicated
// integration user. The access token is cached in module scope and refreshed once
// when Salesforce answers 401 (nonprofit editions have low daily API limits).
//
// Match: the normalized email against the configured contact email fields,
// ignoring deceased contacts and contacts without a household (NPSP: the
// household is Contact.AccountId). Standing is one temple-owned boolean (formula)
// field on the household Account; the temple's admin decides what it means. The
// external id is always the household id.
//
// NPSP only. Nonprofit Cloud models households differently (person accounts and
// party relationship groups) and needs its own household query before enabling.
//
// Errors: transport failures throw (the verifier backs off and uses the cache).
// Configuration errors (bad credentials, unknown field) throw MembershipConfigError,
// classified by Salesforce errorCode, so the verifier fails fast. Neither ever
// carries the email or a response body.
//
// Env: SF_LOGIN_URL, SF_CLIENT_ID, SF_USERNAME, SF_PRIVATE_KEY (base64 PEM),
// SF_GOOD_STANDING_FIELD, SF_EMAIL_FIELDS (optional, comma-separated),
// SF_DECEASED_FIELD (optional).

import { createSign } from 'node:crypto'
import { MembershipConfigError, type MembershipProvider, type MembershipResult } from './provider.ts'

const API_VERSION = 'v60.0'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // same rule the RSVP/checkout forms use
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const DEFAULT_EMAIL_FIELDS = ['Email', 'npe01__HomeEmail__c', 'npe01__WorkEmail__c', 'npe01__AlternateEmail__c']
export const DEFAULT_DECEASED_FIELD = 'npsp__Deceased__c'

// Salesforce errorCodes (REST) and OAuth `error` values that mean "fix the setup",
// not "try again later".
const CONFIG_ERROR_CODES = new Set([
  'INVALID_FIELD',
  'INVALID_TYPE',
  'MALFORMED_QUERY',
  'INVALID_QUERY_FILTER_OPERATOR',
  'API_DISABLED_FOR_ORG',
  'INSUFFICIENT_ACCESS',
  'NOT_FOUND',
  'invalid_grant',
  'invalid_client',
  'invalid_client_id',
  'invalid_app_access',
  'unsupported_grant_type',
])

export type SalesforceConfig = {
  loginUrl: string
  clientId: string
  username: string
  privateKeyPem: string
  goodStandingField: string
  emailFields: string[]
  deceasedField: string
}

type Fetch = typeof fetch
type Token = { accessToken: string; instanceUrl: string }

// SOQL string literal: backslash and single quote are the characters that can
// break out of '...'. Escape backslash first so the quote escape is not doubled.
export function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

// Field names are interpolated into SOQL, so they must be plain identifiers.
function ident(name: string, envName: string): string {
  if (!IDENT_RE.test(name)) throw new MembershipConfigError(`${envName}: invalid field name`)
  return name
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): SalesforceConfig {
  const need = (k: string) => {
    const v = env[k]?.trim()
    if (!v) throw new MembershipConfigError(`${k} is not set`)
    return v
  }
  const emailFields = (env.SF_EMAIL_FIELDS?.trim() ? env.SF_EMAIL_FIELDS.split(',') : DEFAULT_EMAIL_FIELDS)
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => ident(f, 'SF_EMAIL_FIELDS'))
  if (emailFields.length === 0) throw new MembershipConfigError('SF_EMAIL_FIELDS is empty')
  return {
    loginUrl: need('SF_LOGIN_URL').replace(/\/+$/, ''),
    clientId: need('SF_CLIENT_ID'),
    username: need('SF_USERNAME'),
    privateKeyPem: Buffer.from(need('SF_PRIVATE_KEY'), 'base64').toString('utf8'),
    goodStandingField: ident(need('SF_GOOD_STANDING_FIELD'), 'SF_GOOD_STANDING_FIELD'),
    emailFields,
    deceasedField: ident(env.SF_DECEASED_FIELD?.trim() || DEFAULT_DECEASED_FIELD, 'SF_DECEASED_FIELD'),
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

// Read only the error code from a failed response; the body is never logged.
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as unknown
    if (Array.isArray(body)) return (body[0] as { errorCode?: string } | undefined)?.errorCode
    return (body as { error?: string } | null)?.error
  } catch {
    return undefined
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  const code = await errorCodeOf(res)
  const label = `salesforce ${what} failed: ${res.status}${code ? ` ${code}` : ''}`
  return code && CONFIG_ERROR_CODES.has(code) ? new MembershipConfigError(label) : new Error(label)
}

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
    if (!res.ok) throw await failure(res, 'token request')
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
      if (!res.ok) throw await failure(res, 'query')
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

      // Living contacts in a household, matched on any configured email field.
      const lit = soqlString(normalized)
      const contacts = await query<{ Id: string; AccountId: string | null }>(
        cfg,
        `SELECT Id, AccountId FROM Contact WHERE (${cfg.emailFields.map((f) => `${f} = ${lit}`).join(' OR ')})` +
          ` AND ${cfg.deceasedField} = false AND AccountId != null`,
      )
      const householdIds = [...new Set(contacts.map((c) => c.AccountId).filter((a): a is string => !!a))]
      if (householdIds.length === 0) return { status: 'not_found', externalId: null, checkedAt }

      const households = await query<Record<string, unknown>>(
        cfg,
        `SELECT Id, ${cfg.goodStandingField} FROM Account WHERE Id IN (${householdIds.map(soqlString).join(', ')})`,
      )
      const inGoodStanding = households.find((h) => h[cfg.goodStandingField] === true)
      if (inGoodStanding) return { status: 'active', externalId: String(inGoodStanding.Id), checkedAt }
      return { status: 'lapsed', externalId: householdIds[0], checkedAt }
    },
  }
}

export const salesforceMembershipProvider = createSalesforceProvider({ config: () => configFromEnv() })
