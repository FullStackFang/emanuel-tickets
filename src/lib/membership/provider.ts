// Membership-provider seam (openspec add-member-auth, design D4). Shaped like the
// payments seam: the app talks only to this contract; a CRM client is imported by
// exactly one module under ./membership. The result type is deliberately small so a
// future standalone verifier can return it unchanged.

export type MembershipStatus = 'active' | 'lapsed' | 'not_found'

export type MembershipResult = {
  status: MembershipStatus
  externalId: string | null // CRM contact or household id; opaque to the app
  checkedAt: Date
}

export interface MembershipProvider {
  readonly id: string
  lookup(input: { email: string }): Promise<MembershipResult> // throws on transport failure
}
