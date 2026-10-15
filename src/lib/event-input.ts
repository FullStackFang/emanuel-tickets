// Shared parsing + validation for the create/edit event forms. Pure functions
// (FormData is a web standard), so both server actions reuse the same rules and
// the same wall-clock -> UTC conversion.

const TZ = 'America/New_York' // the whole app displays and enters times in NY.
// Capacity is required on ticket_types and enforced by a DB oversell check.
// "No limit" isn't a first-class concept yet, so a blank capacity stores a
// ceiling high enough to never bind for a temple event.
export const NO_LIMIT = 100_000
const MAX_TITLE = 200

export type ParsedEvent = {
  title: string
  description: string | null
  location: string | null
  category: string | null
  startsAt: string
  capacity: number
  priceCents: number
  memberPriceCents: number | null // null: same price for everyone
  membersOnly: boolean
  publish: boolean
}

// Interpret a wall-clock date+time as America/New_York and return the matching
// UTC instant. The offset is read at the entered moment, so DST is handled
// (only the ~1h/year ambiguous fold is approximate, which is acceptable here).
function nyWallTimeToUtcISO(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null
  const wallAsUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`)
  if (Number.isNaN(wallAsUtcMs)) return null
  const guess = new Date(wallAsUtcMs)
  const utcEcho = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzEcho = new Date(guess.toLocaleString('en-US', { timeZone: TZ })).getTime()
  const offsetMs = tzEcho - utcEcho // negative for NY (UTC-4/-5)
  return new Date(wallAsUtcMs - offsetMs).toISOString()
}

export function parseEventForm(
  formData: FormData,
): { ok: true; value: ParsedEvent } | { ok: false; error: string } {
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const location = String(formData.get('location') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim()
  const date = String(formData.get('date') ?? '')
  const time = String(formData.get('time') ?? '')
  const capacityRaw = String(formData.get('capacity') ?? '').trim()
  const priceMode = String(formData.get('priceMode') ?? 'free')
  const priceRaw = String(formData.get('priceAmount') ?? '').trim()
  const publish = String(formData.get('publish') ?? 'published') === 'published'

  if (!title) return { ok: false, error: 'Please give the event a name.' }
  if (title.length > MAX_TITLE)
    return { ok: false, error: `Event name must be ${MAX_TITLE} characters or fewer.` }

  const startsAt = nyWallTimeToUtcISO(date, time)
  if (!startsAt) return { ok: false, error: 'Please choose a start date and time.' }

  let capacity = NO_LIMIT
  if (capacityRaw) {
    const n = Number.parseInt(capacityRaw, 10)
    if (!Number.isInteger(n) || n < 1)
      return { ok: false, error: 'Capacity must be a whole number of 1 or more.' }
    capacity = n
  }

  let priceCents = 0
  if (priceMode === 'paid') {
    const dollars = Number.parseFloat(priceRaw)
    if (!Number.isFinite(dollars) || dollars <= 0)
      return { ok: false, error: 'Enter a ticket price greater than $0, or choose Free.' }
    priceCents = Math.round(dollars * 100)
  }

  // Member price only means something on a paid ticket (a free one is free for all).
  let memberPriceCents: number | null = null
  const memberRaw = String(formData.get('memberPriceAmount') ?? '').trim()
  if (priceMode === 'paid' && memberRaw) {
    const dollars = Number.parseFloat(memberRaw)
    const cents = Math.round(dollars * 100)
    if (!Number.isFinite(dollars) || cents < 0 || Math.abs(dollars * 100 - cents) > 1e-6)
      return { ok: false, error: 'Member price must be $0 or more, in dollars and cents.' }
    memberPriceCents = cents
  }
  const membersOnly = formData.get('membersOnly') === 'on'

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      location: location || null,
      category: category || null,
      startsAt,
      capacity,
      priceCents,
      memberPriceCents,
      membersOnly,
      publish,
    },
  }
}
