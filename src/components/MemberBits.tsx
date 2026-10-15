// Small membership UI pieces shared by the header and the event page. Server
// components: MismatchNote reads OFFICE_CONTACT_EMAIL from the server env.

export function MemberBadge({ label = 'Member', className = '' }: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-accent-50 px-2 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-[var(--color-accent-900)] ${className}`}
    >
      {label}
    </span>
  )
}

// Shown to signed-in attendees the CRM did not confirm. `lapsed` means the email
// matched a record that is not in good standing; anything else means no match.
export function MismatchNote({ status }: { status?: string }) {
  const office = process.env.OFFICE_CONTACT_EMAIL
  const lead =
    status === 'lapsed'
      ? 'We found your email but couldn’t confirm a current membership.'
      : 'We couldn’t match this email to a membership.'
  return (
    <span className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
      {lead}{' '}
      {office ? (
        <>
          Email the office at{' '}
          <a href={`mailto:${office}`} className="underline underline-offset-2">
            {office}
          </a>{' '}
          and we&rsquo;ll update your record.
        </>
      ) : (
        'Contact the temple office and we’ll update your record.'
      )}
    </span>
  )
}
