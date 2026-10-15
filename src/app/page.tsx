import { SiteHeader } from '@/components/SiteHeader'
import { FeaturedEvent } from '@/components/FeaturedEvent'
import { EventRow } from '@/components/EventRow'
import { EventCard } from '@/components/EventCard'
import { GroupRail } from '@/components/GroupRail'
import { GroupNav } from '@/components/GroupNav'
import { getPublishedEvents, getEventGroups, viewOf } from '@/lib/events'

export const dynamic = 'force-dynamic' // availability is live; don't cache the list

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 px-3 font-mono text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
      {children}
    </h2>
  )
}

export default async function Home() {
  const [events, groups] = await Promise.all([getPublishedEvents(), getEventGroups()])
  const now = new Date()
  const upcoming = events.filter((e) => !viewOf(e, { now }).hasEnded)
  const past = events.filter((e) => viewOf(e, { now }).hasEnded).reverse()

  const [featured, ...restUpcoming] = upcoming
  // Grouped events go into their group's rail; leftover (ungrouped) events show
  // in the flat "Upcoming" list. The featured event is dropped from its rail so
  // it isn't shown twice.
  const railFor = (slug: string) =>
    restUpcoming.filter((e) => e.group_slug === slug)
  const ungrouped = restUpcoming.filter((e) => !e.group_slug)

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 sm:px-6">
        <GroupNav groups={groups} active="all" />
        <div className="border-b border-[var(--border-subtle)] py-10 text-center sm:py-14">
          <p className="mb-3.5 font-mono text-xs uppercase tracking-[0.22em] text-[var(--text-accent)]">
            Temple Emanu-El · New York City
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.02] tracking-tight text-[var(--text-primary)] sm:text-5xl">
            Come, let us gather.
          </h1>
          <p className="mx-auto mt-3 max-w-prose text-[var(--text-secondary)]">
            Gatherings, learning, music, and community &mdash; reserve your place.
          </p>
        </div>

        {upcoming.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-16 text-center">
            <p className="font-display text-xl font-semibold text-[var(--text-primary)]">
              No upcoming events just yet
            </p>
            <p className="mt-1 text-[var(--text-secondary)]">
              Check back soon, or follow a shared link to an event.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8">
              <FeaturedEvent event={featured} />
            </div>

            {groups.map((g) => (
              <GroupRail key={g.slug} group={g} events={railFor(g.slug)} />
            ))}

            {ungrouped.length > 0 && (
              <section className="mt-12">
                <SectionLabel>More at Temple Emanu-El</SectionLabel>
                <div className="mt-2 -mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {ungrouped.map((e) => (
                    <div key={e.id} className="w-60 shrink-0 snap-start">
                      <EventCard event={e} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
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
