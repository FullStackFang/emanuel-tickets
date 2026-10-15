import { createClient } from '@/lib/supabase/server'
import type { EventGroup, EventRecord } from '@/lib/event-format'

// Server-only event data access. Uses the SSR (anon) client, so Row-Level
// Security limits results to published events automatically.
// Pure display helpers/types live in ./event-format (client-safe) and are
// re-exported here for convenience on server surfaces.
export * from '@/lib/event-format'

const SELECT =
  'id,title,description,location,starts_at,status,category,group_slug,ticket_types(id,name,price_cents,member_price_cents,members_only,capacity,sold,held)'

export async function getPublishedEvents(): Promise<EventRecord[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select(SELECT)
    .eq('status', 'published')
    .order('starts_at', { ascending: true })
  if (error) throw error
  return (data as EventRecord[]) ?? []
}

// A host's own events, every status (draft/published/cancelled). RLS's
// events_select_own already restricts rows to the caller, but we also filter by
// host_id explicitly so published events by *other* hosts don't leak in.
export async function getHostEvents(hostId: string): Promise<EventRecord[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select(SELECT)
    .eq('host_id', hostId)
    .order('starts_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data as EventRecord[]) ?? []
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getEvent(id: string): Promise<EventRecord | null> {
  // Ids come from the URL; a non-UUID can never match, so treat it as "not found"
  // rather than letting Postgres raise on invalid uuid syntax.
  if (!UUID_RE.test(id)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.from('events').select(SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as EventRecord | null) ?? null
}

export async function getEventGroups(): Promise<EventGroup[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_groups')
    .select('slug,name,tagline,blurb,accent,sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data as EventGroup[]) ?? []
}

export async function getEventGroup(slug: string): Promise<EventGroup | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_groups')
    .select('slug,name,tagline,blurb,accent,sort_order')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return (data as EventGroup | null) ?? null
}

export async function getPublishedEventsByGroup(slug: string): Promise<EventRecord[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select(SELECT)
    .eq('status', 'published')
    .eq('group_slug', slug)
    .order('starts_at', { ascending: true })
  if (error) throw error
  return (data as EventRecord[]) ?? []
}
