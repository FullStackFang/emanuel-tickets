import type { EventStatus } from '@/lib/event-format'

// Small state badge. Two variants: `list` (tinted, on the warm paper canvas) and
// `cover` (sits on a dark stained-glass mesh, so it uses solid/light fills).
const LABELS: Record<EventStatus, string> = {
  available: 'Open',
  almost_full: 'Left',
  sold_out: 'Sold out',
  members_only: 'For members',
  ended: 'Ended',
}

const LIST: Record<EventStatus, string> = {
  available: 'bg-[rgb(30_71_133_/_0.10)] text-[var(--text-brand)]',
  almost_full: 'bg-[rgb(234_179_8_/_0.9)] text-[#3d2b06]',
  sold_out: 'bg-[rgb(28_25_23_/_0.08)] text-[var(--text-secondary)]',
  members_only: 'bg-accent-50 text-[var(--color-accent-900)]',
  ended: 'bg-[rgb(28_25_23_/_0.06)] text-[var(--text-tertiary)]',
}

const COVER: Record<EventStatus, string> = {
  available: 'bg-[rgb(255_255_255_/_0.92)] text-[var(--text-brand)]',
  almost_full: 'bg-[rgb(234_179_8_/_0.95)] text-[#3d2b06]',
  sold_out: 'bg-[rgb(28_25_23_/_0.6)] text-white',
  members_only: 'bg-[rgb(255_255_255_/_0.92)] text-[var(--color-accent-900)]',
  ended: 'bg-[rgb(28_25_23_/_0.5)] text-white',
}

export function StatusPill({
  status,
  seatsLeft,
  variant = 'list',
}: {
  status: EventStatus
  seatsLeft?: number
  variant?: 'list' | 'cover'
}) {
  const cls = variant === 'cover' ? COVER[status] : LIST[status]
  const label =
    status === 'almost_full' && seatsLeft != null ? `${seatsLeft} left` : LABELS[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-2xs font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  )
}
