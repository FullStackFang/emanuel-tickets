// Dev/test membership provider: no CRM. MEMBERSHIP_FAKE_ACTIVE and
// MEMBERSHIP_FAKE_LAPSED are comma-separated email lists; any other email is
// not_found. Read on every lookup so tests can change them at runtime.

import type { MembershipProvider } from './provider.ts'

const list = (v: string | undefined) =>
  new Set((v ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))

export const fakeMembershipProvider: MembershipProvider = {
  id: 'fake',
  async lookup({ email }) {
    const e = email.trim().toLowerCase()
    const status = list(process.env.MEMBERSHIP_FAKE_ACTIVE).has(e)
      ? 'active'
      : list(process.env.MEMBERSHIP_FAKE_LAPSED).has(e)
        ? 'lapsed'
        : 'not_found'
    return { status, externalId: status === 'not_found' ? null : `fake:${e}`, checkedAt: new Date() }
  },
}
