// Membership provider registry. MEMBERSHIP_PROVIDER picks the active module, with
// the same fallback rules as the payments registry: fake outside production, a
// loud error in production when unset.

import type { MembershipProvider } from './provider.ts'

export * from './provider.ts'

const registry: Record<string, () => Promise<MembershipProvider>> = {
  fake: () => import('./fake.ts').then((m) => m.fakeMembershipProvider),
  salesforce: () => import('./salesforce.ts').then((m) => m.salesforceMembershipProvider),
}

export function activeMembershipProviderId(): string {
  const id = process.env.MEMBERSHIP_PROVIDER?.trim()
  if (id) return id
  if (process.env.NODE_ENV !== 'production') return 'fake'
  throw new Error('MEMBERSHIP_PROVIDER is not set')
}

export async function getMembershipProvider(
  id: string = activeMembershipProviderId(),
): Promise<MembershipProvider> {
  const load = registry[id]
  if (!load) throw new Error(`unknown membership provider: ${id}`)
  return load()
}
