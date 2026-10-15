import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import { CreateEventForm } from './CreateEventForm'
import { requireHost } from '@/lib/supabase/viewer'

export const metadata: Metadata = { title: 'Create event · Emanuel Tickets' }

export default async function CreateEventPage() {
  await requireHost()

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
          Create an event
        </h1>
        <CreateEventForm />
      </main>
    </>
  )
}
