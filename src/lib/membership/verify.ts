// Membership verification and the per-user cache (openspec add-member-auth D5,
// launch-member-signin D5). SERVER-ONLY. The memberships table is RLS-forced with
// no policies, so every read and write goes through the service-role client here.
//
//   verifyMembership      : ask the CRM (bounded), upsert on success, back-off on failure
//   getMembership         : the cached row (header badge, member prompts)
//   ensureFreshMembership : the one call the purchase path makes
//   checkAgain            : "Check again" — ignores the back-off, once per 2 minutes
//   membershipDisplay     : what a cached row means for the page (unknown = no note)
//
// Cache rules: an active result is reused for 24 h, lapsed/not_found for 1 h. After a
// failure the purchase path skips the provider for 5 minutes, and a cached active
// result keeps counting for up to 7 days past its verification. A row verified for a
// different email (by hash) is never reused. A failure with nothing cached writes an
// `unknown` row so the back-off still applies.
//
// Never throws to callers: a CRM outage must not block sign-in, RSVP, or checkout.
// Logs carry user_id, never email.

import { createHash } from 'node:crypto'
import type { Viewer } from '../supabase/viewer.ts'
import { MembershipConfigError, type MembershipProvider, type MembershipStatus } from './provider.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
export const ACTIVE_TTL_MS = 24 * HOUR
export const OTHER_TTL_MS = HOUR
export const BACKOFF_MS = 5 * MINUTE
export const STALE_CAP_MS = 7 * 24 * HOUR
export const CHECK_AGAIN_MS = 2 * MINUTE
export const BUDGET_MS = 5000

export type CachedStatus = MembershipStatus | 'unknown'

export type MembershipRow = {
  user_id: string
  provider: string
  external_id: string | null
  status: CachedStatus
  verified_at: string
  expires_at: string
  retry_after: string | null
  email_sha256: string | null
}

export type MembershipStore = {
  get(userId: string): Promise<MembershipRow | null>
  put(row: MembershipRow): Promise<void>
}

type Deps = {
  store: MembershipStore
  provider: () => Promise<MembershipProvider>
  now?: () => Date
  budgetMs?: number
}

export const emailSha256 = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

// What a cached row means for one viewer right now. `unknown` (no row, a failure
// row, another email, or an active result too old to trust) shows no member note.
export function membershipDisplay(row: MembershipRow | null, email: string, now = new Date()): CachedStatus {
  if (!row || !email.trim() || row.email_sha256 !== emailSha256(email)) return 'unknown'
  if (row.status === 'active' && now.getTime() - ms(row.verified_at) > STALE_CAP_MS) return 'unknown'
  return row.status
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('membership lookup timed out')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

export function membershipVerifier({ store, provider, now = () => new Date(), budgetMs = BUDGET_MS }: Deps) {
  async function getMembership(userId: string): Promise<MembershipRow | null> {
    try {
      return await store.get(userId)
    } catch (err) {
      console.error(`membership: cache read failed for user ${userId}`, err)
      return null
    }
  }

  async function put(row: MembershipRow) {
    try {
      await store.put(row)
    } catch (err) {
      console.error(`membership: cache write failed for user ${row.user_id}`, err)
    }
  }

  async function verifyMembership(userId: string, email: string): Promise<CachedStatus> {
    if (!email.trim()) return 'unknown' // nothing to look up
    let providerId = 'unconfigured'
    // One total budget for the lookup and its single retry.
    const deadline = Date.now() + budgetMs
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      try {
        const p = await provider()
        providerId = p.id
        const result = await withTimeout(p.lookup({ email }), remaining)
        const verifiedAt = now()
        const ttl = result.status === 'active' ? ACTIVE_TTL_MS : OTHER_TTL_MS
        await store.put({
          user_id: userId,
          provider: p.id,
          external_id: result.externalId,
          status: result.status,
          verified_at: verifiedAt.toISOString(),
          expires_at: new Date(verifiedAt.getTime() + ttl).toISOString(),
          retry_after: null,
          email_sha256: emailSha256(email),
        })
        return result.status
      } catch (err) {
        if (err instanceof MembershipConfigError) {
          console.error(`membership: provider misconfigured (user ${userId}): ${err.message}`)
          break // retrying cannot help
        }
        console.error(`membership: lookup attempt ${attempt + 1} failed for user ${userId}`, err)
      }
    }

    // Failure: start the back-off, keep any cached result, and report what it still
    // supports (unknown when it is missing, for another email, or too old).
    const t = now()
    const retryAfter = new Date(t.getTime() + BACKOFF_MS).toISOString()
    const row = await getMembership(userId)
    if (row) {
      await put({ ...row, retry_after: retryAfter })
      return membershipDisplay(row, email, t)
    }
    await put({
      user_id: userId,
      provider: providerId,
      external_id: null,
      status: 'unknown',
      verified_at: t.toISOString(),
      expires_at: t.toISOString(),
      retry_after: retryAfter,
      email_sha256: emailSha256(email),
    })
    return 'unknown'
  }

  async function ensureFreshMembership(viewer: Viewer | null): Promise<{ isMember: boolean }> {
    if (!viewer) return { isMember: false }
    const row = await getMembership(viewer.userId)
    const t = now()
    const shown = membershipDisplay(row, viewer.email, t)
    // Fresh and for this email: reuse without asking the provider.
    if (row && shown !== 'unknown' && ms(row.expires_at) > t.getTime()) return { isMember: shown === 'active' }
    // Backing off after a failure: use what the cache still supports.
    if (row && ms(row.retry_after) > t.getTime()) return { isMember: shown === 'active' }
    return { isMember: (await verifyMembership(viewer.userId, viewer.email)) === 'active' }
  }

  // "Check again": an immediate provider call even during the back-off, limited to
  // once per 2 minutes by the last verification time.
  async function checkAgain(viewer: Viewer): Promise<{ status: CachedStatus; limited: boolean }> {
    const row = await getMembership(viewer.userId)
    if (row && now().getTime() - ms(row.verified_at) < CHECK_AGAIN_MS)
      return { status: membershipDisplay(row, viewer.email, now()), limited: true }
    return { status: await verifyMembership(viewer.userId, viewer.email), limited: false }
  }

  return { verifyMembership, getMembership, ensureFreshMembership, checkAgain }
}

// Default wiring: the memberships table via the service-role client, and the
// configured provider. Imported lazily so tests can use membershipVerifier alone.
const supabaseStore: MembershipStore = {
  async get(userId) {
    const { createAdminClient } = await import('../supabase/admin.ts')
    const { data, error } = await createAdminClient()
      .from('memberships')
      .select('user_id, provider, external_id, status, verified_at, expires_at, retry_after, email_sha256')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return data as MembershipRow | null
  },
  async put(row) {
    const { createAdminClient } = await import('../supabase/admin.ts')
    const { error } = await createAdminClient().from('memberships').upsert(row)
    if (error) throw error
  },
}

const defaultVerifier = membershipVerifier({
  store: supabaseStore,
  provider: () => import('./index.ts').then((m) => m.getMembershipProvider()),
})

export const verifyMembership = defaultVerifier.verifyMembership
export const getMembership = defaultVerifier.getMembership
export const ensureFreshMembership = defaultVerifier.ensureFreshMembership
export const checkAgain = defaultVerifier.checkAgain
