import Link from 'next/link'
import { formatPrice } from '@/lib/event-format'
import { checkMembershipAgain } from '@/app/actions/membership'

// Small membership UI pieces shared by the header and the event page. Server
// components: MemberPrompt reads OFFICE_CONTACT_EMAIL and MEMBERSHIP_JOIN_URL
// (the temple's join/renew page) from the server env.

export function MemberBadge({ label = 'Member', className = '' }: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-accent-50 px-2 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-[var(--color-accent-900)] ${className}`}
    >
      {label}
    </span>
  )
}

const LINK = 'focus-ring rounded font-medium text-[var(--text-brand)] underline underline-offset-4'
const SMALL_LINK = 'underline underline-offset-2'

// The one next step for a viewer who isn't getting member benefits on this event
// (launch-member-signin, D3). Never rendered for hosts, active members, or an
// unknown status (CRM unreachable): the page decides that.
//   guest     -> sign in
//   lapsed    -> renew
//   not_found -> try the on-file email, or ask the office, or become a member
export function MemberPrompt({
  state,
  eventId,
  memberPriceCents,
  membersOnly,
}: {
  state: 'guest' | 'lapsed' | 'not_found'
  eventId: string
  memberPriceCents?: number // lowest member price on the event, if any
  membersOnly: boolean // the event has a members-only ticket type
}) {
  const path = `/e/${eventId}`
  const signIn = `/signin?next=${encodeURIComponent(path)}`
  const joinUrl = process.env.MEMBERSHIP_JOIN_URL
  const office = process.env.OFFICE_CONTACT_EMAIL

  if (state === 'guest')
    return (
      <span className="mt-0.5 text-sm text-[var(--text-secondary)]">
        {membersOnly ? (
          <>
            Members:{' '}
            <Link href={signIn} className={LINK}>
              sign in to reserve
            </Link>
          </>
        ) : (
          <>
            {memberPriceCents != null && <>Members: {formatPrice(memberPriceCents)} · </>}
            <Link href={signIn} className={LINK}>
              Sign in with your email
            </Link>
          </>
        )}
      </span>
    )

  const checkAgain = (
    <form action={checkMembershipAgain} className="inline">
      <input type="hidden" name="path" value={path} />
      <button type="submit" className={`focus-ring rounded ${SMALL_LINK}`}>
        Check again
      </button>
    </form>
  )

  if (state === 'lapsed')
    return (
      <span className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
        {membersOnly
          ? 'For members — renew to reserve.'
          : 'We found your email but couldn’t confirm a current membership.'}{' '}
        {joinUrl ? (
          <a href={joinUrl} className={SMALL_LINK}>
            Renew your membership
          </a>
        ) : (
          'Contact the temple office to renew.'
        )}{' '}
        · {checkAgain}
      </span>
    )

  return (
    <span className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
      We couldn&rsquo;t match this email to a membership.{' '}
      <Link href={signIn} className={SMALL_LINK}>
        Try the email the temple has on file
      </Link>{' '}
      (the one that gets the bulletin)
      {office ? (
        <>
          , or email the office at{' '}
          <a href={`mailto:${office}`} className={SMALL_LINK}>
            {office}
          </a>
        </>
      ) : (
        ', or contact the temple office'
      )}
      .{' '}
      {joinUrl && (
        <>
          Not a member yet?{' '}
          <a href={joinUrl} className={SMALL_LINK}>
            Become a member
          </a>
          .{' '}
        </>
      )}
      {checkAgain}
    </span>
  )
}
