import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import { EventForm, type EventFormValues } from '@/components/EventForm'
import { createClient } from '@/lib/supabase/server'
import { nyInputParts } from '@/lib/event-format'
import { NO_LIMIT } from '@/lib/event-input'
import { updateEvent } from './actions'
import { requireHost } from '@/lib/supabase/viewer'

export const metadata: Metadata = { title: 'Edit event · Emanuel Tickets' }
export const dynamic = 'force-dynamic' // a host's own draft/published event is live

type EditRow = {
  id: string
  title: string | null
  description: string | null
  location: string | null
  starts_at: string | null
  status: string
  category: string | null
  ticket_types: {
    price_cents: number
    member_price_cents: number | null
    members_only: boolean
    capacity: number
    sold: number
    held: number
    created_at: string
  }[]
}

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await requireHost()
  const supabase = await createClient()

  // host_id filter (belt and suspenders over RLS) so a published event owned by
  // someone else is never editable here.
  const { data, error } = await supabase
    .from('events')
    .select(
      'id,title,description,location,starts_at,status,category,ticket_types(price_cents,member_price_cents,members_only,capacity,sold,held,created_at)',
    )
    .eq('id', id)
    .eq('host_id', viewer.userId)
    .maybeSingle()
  if (error) throw error
  const event = data as EditRow | null
  if (!event) notFound()

  const tt = [...event.ticket_types].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )[0]
  const when = nyInputParts(event.starts_at)
  const initial: EventFormValues = {
    title: event.title ?? '',
    date: when.date,
    time: when.time,
    location: event.location ?? '',
    description: event.description ?? '',
    category: event.category ?? '',
    capacity: tt && tt.capacity !== NO_LIMIT ? String(tt.capacity) : '',
    priceMode: tt && tt.price_cents > 0 ? 'paid' : 'free',
    priceAmount: tt && tt.price_cents > 0 ? String(tt.price_cents / 100) : '',
    memberPriceAmount: tt?.member_price_cents != null ? String(tt.member_price_cents / 100) : '',
    membersOnly: tt?.members_only ?? false,
    publish: event.status === 'published' ? 'published' : 'draft',
  }

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-20 pt-6 sm:px-6">
        <Link
          href="/dashboard"
          className="focus-ring text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          &larr; Events
        </Link>
        <h1 className="mt-3 mb-6 font-display text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          Edit event
        </h1>
        <EventForm
          action={updateEvent}
          initial={initial}
          eventId={event.id}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </main>
    </>
  )
}
