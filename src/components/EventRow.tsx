import Link from 'next/link'
import { StatusPill } from '@/components/StatusPill'
import {
  meshFor,
  viewOf,
  dateParts,
  formatEventTime,
  formatPrice,
  type EventRecord,
} from '@/lib/event-format'

const DIM = 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35))'

// A list row with a small stained-glass "date chip" in the event's own hues.
// `hostView` shows full inventory (members-only types included) on host surfaces.
export function EventRow({
  event,
  muted = false,
  hostView = false,
}: {
  event: EventRecord
  muted?: boolean
  hostView?: boolean
}) {
  const v = viewOf(event, { isMember: hostView })
  const { month, day } = dateParts(event.starts_at)

  return (
    <li>
      <Link
        href={`/e/${event.id}`}
        className="group flex items-center gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <div
          className={`relative flex h-14 w-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl text-white shadow-[0_6px_14px_-8px_rgba(0,0,0,0.45)] ${
            muted ? 'opacity-70' : ''
          }`}
          style={{ background: meshFor(event.id) }}
        >
          <div className="absolute inset-0" style={{ background: DIM }} />
          <span className="relative z-10 font-mono text-2xs uppercase tracking-wider">{month}</span>
          <span className="relative z-10 font-display text-xl font-semibold leading-none">{day}</span>
        </div>

        <div className="min-w-0 flex-1">
          {event.category && (
            <div className="font-mono text-2xs uppercase tracking-wider text-[var(--text-tertiary)]">
              {event.category}
            </div>
          )}
          <h3 className="truncate font-display text-lg font-semibold text-[var(--text-primary)] group-hover:text-[var(--text-brand)]">
            {event.title}
          </h3>
          <p className="truncate text-sm text-[var(--text-secondary)]">
            {formatEventTime(event.starts_at)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill status={v.status} seatsLeft={v.availableSeats} />
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {v.isFree ? 'Free' : formatPrice(v.minPriceCents)}
          </span>
        </div>
      </Link>
    </li>
  )
}
