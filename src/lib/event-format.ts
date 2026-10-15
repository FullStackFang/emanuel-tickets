// Pure, client-safe event types + display helpers. No server imports, so both
// Client and Server Components can use these. Data access lives in events.ts.

export type TicketType = {
  id: string
  name: string
  price_cents: number
  member_price_cents: number | null // null: same price for everyone
  members_only: boolean
  capacity: number
  sold: number
  held: number
}

// The price this viewer pays for a ticket type: the member price when the viewer
// is an active member and the type has one, else the regular price. The single
// source of pricing truth for pages and the purchase path alike.
export function effectivePriceCents(
  ticket: Pick<TicketType, 'price_cents' | 'member_price_cents'>,
  isMember: boolean,
): number {
  return isMember && ticket.member_price_cents != null ? ticket.member_price_cents : ticket.price_cents
}

export type EventRecord = {
  id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string | null
  status: string
  category: string | null
  group_slug: string | null
  ticket_types: TicketType[]
}

// An organizing program (The Streicker Center, Interfaith, ...) an event belongs
// to. Drives grouped browsing on the home page and a per-group landing page.
export type EventGroup = {
  slug: string
  name: string
  tagline: string | null
  blurb: string | null
  accent: string | null
  sort_order: number
}

// Stained-glass "cover" gradients drawn from the rose-window hues. An event's id
// deterministically selects one, so a given event always wears the same colors.
const MESHES = [
  'radial-gradient(60% 70% at 20% 20%,#016395 0,transparent 60%),radial-gradient(55% 60% at 80% 15%,#615c9b 0,transparent 60%),radial-gradient(70% 80% at 65% 90%,#91226d 0,transparent 60%),radial-gradient(60% 70% at 15% 85%,#0085ab 0,transparent 60%),#143a63',
  'radial-gradient(60% 70% at 25% 25%,#408796 0,transparent 60%),radial-gradient(60% 65% at 85% 30%,#b18c52 0,transparent 60%),radial-gradient(70% 80% at 60% 95%,#016395 0,transparent 60%),#17423f',
  'radial-gradient(60% 70% at 22% 18%,#991b39 0,transparent 60%),radial-gradient(60% 65% at 82% 20%,#91226d 0,transparent 60%),radial-gradient(70% 80% at 60% 92%,#615c9b 0,transparent 60%),#4a1230',
  'radial-gradient(60% 70% at 20% 22%,#0085ab 0,transparent 60%),radial-gradient(60% 65% at 85% 22%,#016395 0,transparent 60%),radial-gradient(70% 80% at 62% 95%,#408796 0,transparent 60%),#0c3f5a',
  'radial-gradient(60% 70% at 22% 20%,#615c9b 0,transparent 60%),radial-gradient(60% 65% at 82% 24%,#b18c52 0,transparent 60%),radial-gradient(70% 80% at 60% 95%,#91226d 0,transparent 60%),#2e2a52',
  'radial-gradient(60% 70% at 24% 22%,#408796 0,transparent 60%),radial-gradient(60% 65% at 80% 18%,#0085ab 0,transparent 60%),radial-gradient(70% 80% at 62% 92%,#615c9b 0,transparent 60%),#123a52',
]

export function meshFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return MESHES[h % MESHES.length]
}

export type EventStatus = 'available' | 'almost_full' | 'sold_out' | 'ended'

// A ticket type as offered to one viewer, at that viewer's price.
export type PurchasableType = {
  id: string
  name: string
  effectivePriceCents: number
  regularPriceCents: number
  memberPriceCents: number | null
  membersOnly: boolean
  remaining: number
}

export type EventView = {
  purchasableTypes: PurchasableType[]
  availableSeats: number
  capacity: number
  minPriceCents: number
  isFree: boolean
  hasEnded: boolean
  status: EventStatus
}

const ALMOST_FULL_FRACTION = 0.1 // <=10% seats left reads as "almost full"

// Availability and pricing as seen by one viewer. Members-only types (and their
// seats) are invisible to non-members. Host surfaces pass { isMember: true } so a
// host always sees full inventory for their own event.
export function viewOf(
  event: EventRecord,
  { isMember = false, now = new Date() }: { isMember?: boolean; now?: Date } = {},
): EventView {
  const visible = event.ticket_types.filter((t) => isMember || !t.members_only)
  const purchasableTypes: PurchasableType[] = visible.map((t) => ({
    id: t.id,
    name: t.name,
    effectivePriceCents: effectivePriceCents(t, isMember),
    regularPriceCents: t.price_cents,
    memberPriceCents: t.member_price_cents,
    membersOnly: t.members_only,
    remaining: Math.max(t.capacity - t.sold - t.held, 0),
  }))
  const capacity = visible.reduce((n, t) => n + t.capacity, 0)
  const availableSeats = purchasableTypes.reduce((n, t) => n + t.remaining, 0)
  const prices = purchasableTypes.map((t) => t.effectivePriceCents)
  const minPriceCents = prices.length ? Math.min(...prices) : 0
  const isFree = prices.length > 0 && prices.every((p) => p === 0)
  const hasEnded = event.starts_at ? new Date(event.starts_at) < now : false

  let status: EventStatus
  if (hasEnded) status = 'ended'
  else if (availableSeats <= 0) status = 'sold_out'
  else if (capacity > 0 && availableSeats <= Math.ceil(capacity * ALMOST_FULL_FRACTION))
    status = 'almost_full'
  else status = 'available'

  return { purchasableTypes, availableSeats, capacity, minPriceCents, isFree, hasEnded, status }
}

export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  const dollars = cents / 100
  return `$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

const TZ = 'America/New_York'

export function formatEventDate(iso: string | null): string {
  if (!iso) return 'Date to be announced'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ,
  }).format(new Date(iso))
}

export function formatEventTime(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso))
}

// "Add to Google Calendar" deep link. No end time in the schema, so assume a
// DEFAULT_DURATION. Dates must be UTC basic format (YYYYMMDDTHHMMSSZ).
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000

function toGCalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function googleCalendarUrl(e: {
  title: string
  starts_at: string | null
  location: string | null
  details?: string | null
}): string | null {
  if (!e.starts_at) return null
  const start = new Date(e.starts_at)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + DEFAULT_DURATION_MS)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${toGCalStamp(start)}/${toGCalStamp(end)}`,
  })
  if (e.location) params.set('location', e.location)
  if (e.details) params.set('details', e.details)
  return `https://www.google.com/calendar/render?${params.toString()}`
}

// Split a stored UTC instant back into the Eastern wall-clock <input type="date">
// and <input type="time"> values, so the edit form starts on the same moment the
// host originally entered.
export function nyInputParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  // en-CA renders YYYY-MM-DD; 24-hour clock; NY zone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour') // Intl can emit "24" at midnight
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` }
}

export function dateParts(iso: string | null): { month: string; day: string } {
  if (!iso) return { month: '', day: '' }
  const d = new Date(iso)
  return {
    month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: TZ }).format(d),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: TZ }).format(d),
  }
}
