import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import { createClient } from '@/lib/supabase/server'
import { CreateEventForm } from './CreateEventForm'

export const metadata: Metadata = { title: 'Create event · Emanuel Tickets' }

export default async function CreateEventPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
