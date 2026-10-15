// Membership verification and the per-user cache (openspec add-member-auth, D5).
// SERVER-ONLY. The memberships table is RLS-forced with no policies, so every read
// and write goes through the service-role client here.
//
//   verifyMembership      : ask the CRM (bounded), upsert on success, cached fallback
//   getMembership         : the cached row (header badge, mismatch note)
//   ensureFreshMembership : the one call the purchase path makes
//
// Never throws to callers: a CRM outage must not block sign-in, RSVP, or checkout.
// Logs carry user_id, never email.

import type { Viewer } from '../supabase/viewer.ts'
import type { MembershipProvider, MembershipStatus } from './provider.ts'

export const RECHECK_MS = 24 * 60 * 60 * 1000
export const BUDGET_MS = 5000

export type MembershipRow = {
  user_id: string
  provider: string
  external_id: string | null
  status: MembershipStatus
  verified_at: string
  expires_at: string
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
  async function cachedStatus(userId: string): Promise<MembershipStatus> {
    try {
      return (await store.get(userId))?.status ?? 'not_found'
    } catch (err) {
      console.error(`membership: cache read failed for user ${userId}`, err)
      return 'not_found'
    }
  }

  async function verifyMembership(userId: string, email: string): Promise<MembershipStatus> {
    // One total budget for the lookup and its single retry.
    const deadline = Date.now() + budgetMs
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      try {
        const p = await provider()
        const result = await withTimeout(p.lookup({ email }), remaining)
        const verifiedAt = now()
        await store.put({
          user_id: userId,
          provider: p.id,
          external_id: result.externalId,
          status: result.status,
          verified_at: verifiedAt.toISOString(),
          expires_at: new Date(verifiedAt.getTime() + RECHECK_MS).toISOString(),
        })
        return result.status
      } catch (err) {
        console.error(`membership: lookup attempt ${attempt + 1} failed for user ${userId}`, err)
      }
    }
    // Failure leaves the row untouched; the cached status (if any) wins for this request.
    return cachedStatus(userId)
  }

  async function getMembership(userId: string): Promise<MembershipRow | null> {
    try {
      return await store.get(userId)
    } catch (err) {
      console.error(`membership: cache read failed for user ${userId}`, err)
      return null
    }
  }

  async function ensureFreshMembership(viewer: Viewer | null): Promise<{ isMember: boolean }> {
    if (!viewer) return { isMember: false }
    const row = await getMembership(viewer.userId)
    if (row && new Date(row.expires_at) > now()) return { isMember: row.status === 'active' }
    return { isMember: (await verifyMembership(viewer.userId, viewer.email)) === 'active' }
  }

  return { verifyMembership, getMembership, ensureFreshMembership }
}

// Default wiring: the memberships table via the service-role client, and the
// configured provider. Imported lazily so tests can use membershipVerifier alone.
const supabaseStore: MembershipStore = {
  async get(userId) {
    const { createAdminClient } = await import('../supabase/admin.ts')
    const { data, error } = await createAdminClient()
      .from('memberships')
      .select('user_id, provider, external_id, status, verified_at, expires_at')
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
