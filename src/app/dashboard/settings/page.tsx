import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { Avatar } from '@/components/Avatar'
import { DisplayNameField } from '@/components/settings/DisplayNameField'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { DangerZone } from '@/components/settings/DangerZone'
import { createClient } from '@/lib/supabase/server'
import { hostProfileFrom } from '@/lib/host'
import { requireHost } from '@/lib/supabase/viewer'
import { signOut } from '@/app/actions/auth'

export const dynamic = 'force-dynamic' // reflects the signed-in host

export const metadata: Metadata = {
  title: 'Profile & settings · Emanuel Tickets',
}

export default async function SettingsPage() {
  await requireHost()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = hostProfileFrom(user)
  const lastSignIn = profile.lastSignInAt
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      }).format(new Date(profile.lastSignInAt))
    : null

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-20 pt-8 sm:px-6">
        <header className="mb-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            Profile &amp; settings
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Manage how you show up as a host and what Emanuel Tickets emails you.
          </p>
        </header>

        {/* Profile */}
        <Section eyebrow="Profile" heading="Your profile">
          <div className="mb-6 flex items-center gap-4">
            <Avatar initials={profile.initials} avatarUrl={profile.avatarUrl} size={60} />
            <p className="text-[13px] text-[var(--text-tertiary)]">
              Your photo comes from your Microsoft account.
            </p>
          </div>

          <DisplayNameField initialName={profile.fullName} />

          <div className="mt-4 grid gap-1.5">
            <label htmlFor="email" className="text-sm font-semibold text-[var(--text-secondary)]">
              Email
            </label>
            <div className="flex items-center gap-3">
              <input
                id="email"
                type="email"
                value={profile.email}
                readOnly
                className="h-10 flex-1 cursor-default rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-[15px] text-[var(--text-tertiary)]"
              />
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--bg-tertiary)] px-2.5 py-1 font-mono text-2xs font-semibold text-[var(--text-tertiary)]">
                <MicrosoftMark />
                Microsoft
              </span>
            </div>
          </div>
        </Section>

        {/* Notifications */}
        <Section eyebrow="Notifications" heading="Email notifications">
          <NotificationSettings
            initialRsvp={profile.notifyRsvp}
            initialWeekly={profile.notifyWeekly}
          />
        </Section>

        {/* Account & security */}
        <Section eyebrow="Account" heading="Account & security">
          <div className="flex items-center gap-3 py-3">
            <MicrosoftMark size={18} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Signed in with Microsoft
              </p>
              <p className="mt-0.5 font-mono text-2xs text-[var(--text-tertiary)]">{profile.email}</p>
            </div>
          </div>
          {lastSignIn && (
            <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] py-3">
              <ClockIcon />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Last sign-in</p>
                <p className="mt-0.5 font-mono text-2xs text-[var(--text-tertiary)]">{lastSignIn}</p>
              </div>
            </div>
          )}
          <p className="mt-3 text-[13px] text-[var(--text-tertiary)]">
            Your password and two-step verification are managed by Microsoft. Emanuel Tickets never sees them.
          </p>

          <form action={signOut} className="mt-5">
            <button
              type="submit"
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
                <path fill="currentColor" d="M8 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3v-1.7H5a.3.3 0 0 1-.3-.3V5a.3.3 0 0 1 .3-.3h3V3z" />
                <path fill="currentColor" d="m13.3 6.3 2.9 2.9c.4.4.4 1 0 1.4l-2.9 2.9-1.2-1.2 1.4-1.4H8.3V9.6h5.2l-1.4-1.4 1.2-1.2z" />
              </svg>
              Sign out
            </button>
          </form>
        </Section>

        {/* Leaving */}
        <Section eyebrow="Leaving" heading="Remove host access" danger>
          <p className="mb-4 max-w-[52ch] text-[13.5px] text-[var(--text-secondary)]">
            Your access to Emanuel Tickets comes from your Temple Emanuel Microsoft account. To fully remove
            your host access, ask an administrator to remove you in Microsoft 365. You can sign out
            of every device below.
          </p>
          <DangerZone />
        </Section>
      </main>
    </>
  )
}

function Section({
  eyebrow,
  heading,
  danger = false,
  children,
}: {
  eyebrow: string
  heading: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section className="border-t border-[var(--border-subtle)] py-8 first-of-type:border-t-0">
      <p className="mb-0.5 font-mono text-2xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
        {eyebrow}
      </p>
      <h2
        className={`mb-5 font-display text-lg font-semibold tracking-tight ${
          danger ? 'text-error-700' : 'text-[var(--text-primary)]'
        }`}
      >
        {heading}
      </h2>
      {children}
    </section>
  )
}

// Microsoft's four-square mark, in its official brand colors.
function MicrosoftMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0 text-[var(--text-tertiary)]">
      <path
        fill="currentColor"
        d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 14.3A6.3 6.3 0 1 1 10 3.7a6.3 6.3 0 0 1 0 12.6zM10.8 6H9.2v4.3l3.6 2.2.8-1.4-2.8-1.7V6z"
      />
    </svg>
  )
}
