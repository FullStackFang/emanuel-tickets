import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import { EventCard } from '@/components/EventCard'
import { EventRow } from '@/components/EventRow'
import { GroupNav } from '@/components/GroupNav'
import { getEventGroup, getEventGroups, getPublishedEventsByGroup, viewOf } from '@/lib/events'

export const dynamic = 'force-dynamic' // availability is live

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const group = await getEventGroup(slug)
  if (!group) return { title: 'Not found · Emanuel Tickets' }
  return {
    title: `${group.name} · Emanuel Tickets`,
    description: group.tagline ?? group.blurb ?? undefined,
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 px-3 font-mono text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
      {children}
    </h2>
  )
}

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const group = await getEventGroup(slug)
  if (!group) notFound()

  const [events, groups] = await Promise.all([
    getPublishedEventsByGroup(slug),
    getEventGroups(),
  ])
  const now = new Date()
  const upcoming = events.filter((e) => !viewOf(e, now).hasEnded)
  const past = events.filter((e) => viewOf(e, now).hasEnded).reverse()

  const accent = group.accent ?? 'var(--color-primary-600)'

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 sm:px-6">
        <GroupNav groups={groups} active={slug} />

        {/* Flavored hero: a wash of the group's accent color */}
        <div
          className="relative mt-4 overflow-hidden rounded-2xl p-7 sm:p-9"
          style={{
            background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, #000))`,
          }}
        >
          <p className="font-mono text-2xs uppercase tracking-[0.22em] text-white/75">
            Temple Emanu-El
          </p>
          <h1
            className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
            style={{ textShadow: '0 2px 14px rgba(0,0,0,0.35)' }}
          >
            {group.name}
          </h1>
          {group.tagline && (
            <p className="mt-2 text-base font-medium text-white/90">{group.tagline}</p>
          )}
          {group.blurb && (
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-white/80">{group.blurb}</p>
          )}
        </div>

        {upcoming.length > 0 ? (
          <section className="mt-10">
            <SectionLabel>Upcoming</SectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {upcoming.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </section>
        ) : (
          <div className="mt-10 rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-16 text-center">
            <p className="font-display text-xl font-semibold text-[var(--text-primary)]">
              No upcoming events just yet
            </p>
            <p className="mt-1 text-[var(--text-secondary)]">Check back soon.</p>
          </div>
        )}

        {past.length > 0 && (
          <section className="mt-12">
            <SectionLabel>Past</SectionLabel>
            <ul className="-mx-3 flex flex-col divide-y divide-[var(--border-subtle)]">
              {past.map((e) => (
                <EventRow key={e.id} event={e} muted />
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  )
}
