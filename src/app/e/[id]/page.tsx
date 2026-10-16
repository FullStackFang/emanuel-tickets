import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/SiteHeader'
import { StatusPill } from '@/components/StatusPill'
import { EventActionBar } from '@/components/EventActionBar'
import { MemberBadge, MemberPrompt } from '@/components/MemberBits'
import { getEvent } from '@/lib/events'
import { getViewer } from '@/lib/supabase/viewer'
import { getMembership, membershipDisplay } from '@/lib/membership/verify'
import {
  meshFor,
  viewOf,
  formatEventDate,
  formatEventTime,
  dateParts,
} from '@/lib/event-format'

export const dynamic = 'force-dynamic' // availability is live

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const event = await getEvent(id)
  if (!event) return { title: 'Event not found · Emanuel Tickets' }
  return {
    title: `${event.title} · Emanuel Tickets`,
    description: event.description ?? undefined,
  }
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}

// A single bordered fact tile. Grows to share the row with its siblings, wraps
// to its own line when the row runs out of width.
function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex grow basis-52 items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3.5">
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-primary-50 text-[var(--text-brand)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className="block truncate font-medium text-[var(--text-primary)]">{value}</span>
      </span>
    </div>
  )
}

// The date tile leads with a small torn-calendar mark (month over day) instead
// of an icon, so the date reads at a glance.
function DateTile({ month, day, value }: { month: string; day: string; value: string }) {
  return (
    <div className="flex grow basis-52 items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3.5">
      <span className="w-13 flex-none overflow-hidden rounded-lg border border-[var(--border-default)] text-center shadow-[var(--shadow-sm)]">
        <span className="block bg-primary-600 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase tracking-wider text-white">
          {month}
        </span>
        <span className="block py-1.5 font-display text-2xl font-semibold leading-none text-[var(--text-primary)]">
          {day}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Date
        </span>
        <span className="block truncate font-medium text-[var(--text-primary)]">{value}</span>
      </span>
    </div>
  )
}

const DIM = 'linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.46))'

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEvent(id)
  if (!event) notFound()

  // Display uses the cached membership; the purchase path re-checks when stale.
  // Hosts get no membership state (and so no member prompts).
  const viewer = await getViewer()
  const shown =
    viewer?.role === 'attendee' ? membershipDisplay(await getMembership(viewer.userId), viewer.email) : null
  const isMember = shown === 'active'
  const v = viewOf(event, { isMember })
  const memberPrices = event.ticket_types
    .map((t) => t.member_price_cents)
    .filter((c): c is number => c != null)
  const membersOnly = event.ticket_types.some((t) => t.members_only)
  const hasMemberOffer = memberPrices.length > 0 || membersOnly
  const promptState = !viewer ? 'guest' : shown === 'lapsed' || shown === 'not_found' ? shown : null
  const { month, day } = dateParts(event.starts_at)
  const time = formatEventTime(event.starts_at)

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-28 pt-4 sm:px-6 sm:pb-16 sm:pt-6">
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <span aria-hidden>&larr;</span> All events
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          {/* Main column */}
          <div className="min-w-0">
            {/* Stained-glass hero, light drifting through the window */}
            <div
              className="relative aspect-[16/9] overflow-hidden rounded-2xl sm:aspect-[16/7]"
              style={{ background: meshFor(event.id) }}
            >
              <div className="absolute inset-0" style={{ background: DIM }} />
              <div className="glass-light" aria-hidden />
              {event.category && (
                <span className="absolute left-4 top-4 z-10 inline-flex items-center rounded-full border border-white/40 bg-black/25 px-2.5 py-1 font-mono text-2xs uppercase tracking-wider text-white backdrop-blur-sm">
                  {event.category}
                </span>
              )}
              <div className="absolute right-4 top-4 z-10">
                <StatusPill status={v.status} seatsLeft={v.availableSeats} variant="cover" />
              </div>
              <div className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-6">
                <h1
                  className="font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
                  style={{ textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}
                >
                  {event.title}
                </h1>
                <p className="mt-2 text-sm text-white/90">Hosted by Temple Emanu-El</p>
              </div>
            </div>

            {/* Fact tiles */}
            <div className="mt-6 flex flex-wrap gap-3">
              <DateTile month={month} day={day} value={formatEventDate(event.starts_at)} />
              <Tile icon={<ClockIcon />} label="Time" value={time || 'TBA'} />
              {event.location && <Tile icon={<PinIcon />} label="Location" value={event.location} />}
            </div>

            {event.description && (
              <section className="mt-8">
                <h2 className="font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  About this gathering
                </h2>
                <div className="mt-3 max-w-prose whitespace-pre-line leading-relaxed text-[var(--text-primary)]">
                  {event.description}
                </div>
              </section>
            )}
          </div>

          {/* Register rail — a card on desktop (sticky), the bottom bar on mobile */}
          <div className="mx-auto w-full max-w-md lg:sticky lg:top-6 lg:mx-0 lg:max-w-none">
            <EventActionBar
              eventId={event.id}
              status={v.status}
              isFree={v.isFree}
              minPriceCents={v.minPriceCents}
              seatsLeft={v.availableSeats}
              ticketTypes={v.purchasableTypes}
              defaultEmail={viewer?.email}
              membersOnlyTypes={v.membersOnlyTypes}
              priceNote={
                !hasMemberOffer ? null : isMember ? (
                  <MemberBadge className="mt-1 self-start" label="Member pricing" />
                ) : promptState ? (
                  <MemberPrompt
                    state={promptState}
                    eventId={event.id}
                    memberPriceCents={memberPrices.length > 0 ? Math.min(...memberPrices) : undefined}
                    membersOnly={membersOnly}
                  />
                ) : null
              }
            />
          </div>
        </div>
      </main>
    </>
  )
}
