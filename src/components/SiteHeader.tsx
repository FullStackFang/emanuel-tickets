import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hostProfileFrom } from '@/lib/host'
import { AccountMenu } from '@/components/AccountMenu'

// Masthead top bar with the wordmark and a gold hairline rule. Reads the auth
// session: signed-out visitors get a quiet "Host sign in" link; a signed-in host
// gets their account menu (Your events / Profile & settings / Sign out). Every
// page that renders this is already `force-dynamic`, so the per-request session
// read costs no caching. `wide` matches the broader explore/listing pages so the
// wordmark stays aligned.
export async function SiteHeader({ wide = false }: { wide?: boolean }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const profile = user ? hostProfileFrom(user) : null

  return (
    <header className="bg-[var(--bg-primary)]">
      <div className={`mx-auto w-full px-5 sm:px-6 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <div className="flex h-16 items-center justify-between">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-[var(--text-primary)]"
          >
            Emanuel <span className="text-[var(--text-brand)]">Tickets</span>
          </Link>

          {profile ? (
            <AccountMenu
              firstName={profile.firstName}
              fullName={profile.fullName}
              email={profile.email}
              initials={profile.initials}
              avatarUrl={profile.avatarUrl}
            />
          ) : (
            <Link
              href="/dashboard"
              className="focus-ring rounded-md border-b border-transparent text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Host sign in
            </Link>
          )}
        </div>
        <div
          className="h-0.5 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--color-accent-700), var(--color-accent-400) 40%, transparent)',
          }}
        />
      </div>
    </header>
  )
}
