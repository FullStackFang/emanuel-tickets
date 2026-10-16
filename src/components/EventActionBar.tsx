'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { formatPrice, type EventStatus, type PurchasableType } from '@/lib/event-format'
import {
  rsvpToEvent,
  startCheckout,
  type RsvpState,
  type CheckoutState,
} from '@/app/e/[id]/actions'

const INPUT =
  'focus-ring h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]'
const FIELD_LABEL =
  'font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]'

// The RSVP / buy affordance. One form lists the ticket types this viewer can buy
// at THEIR price; the chosen type's price decides the path: $0 RSVPs (reserve ->
// confirm, no payment), anything above collects payment via the provider. The
// server re-derives the price either way. Sold-out and ended states are terminal.
export function EventActionBar({
  eventId,
  status,
  isFree,
  minPriceCents,
  seatsLeft,
  ticketTypes,
  defaultEmail = '',
  priceNote,
  membersOnlyTypes = [],
}: {
  eventId: string
  status: EventStatus
  isFree: boolean
  minPriceCents: number
  seatsLeft: number
  ticketTypes: PurchasableType[]
  defaultEmail?: string // prefilled from the session when signed in; stays editable
  priceNote?: ReactNode // member pricing line under the price (page decides the copy)
  membersOnlyTypes?: PurchasableType[] // listed as "For members"; never selectable here
}) {
  const [open, setOpen] = useState(false) // form disclosure
  const [state, formAction, pending] = useActionState<RsvpState, FormData>(rsvpToEvent, null)
  const [payState, payAction, paying] = useActionState<CheckoutState, FormData>(startCheckout, null)
  const options = ticketTypes.filter((t) => t.remaining > 0)
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? '')
  const selected = options.find((t) => t.id === selectedId) ?? options[0]
  const freeChoice = (selected?.effectivePriceCents ?? 0) === 0

  const priceLabel = status === 'members_only' ? 'For members' : isFree ? 'Free' : formatPrice(minPriceCents)
  const ctaLabel = isFree ? 'RSVP' : 'Get tickets'
  const actionable = status === 'available' || status === 'almost_full'
  const confirmed = !!(state && state.ok)
  const error = freeChoice
    ? state && !state.ok && state.error
    : payState && !payState.ok && payState.error

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[var(--shadow-lg)] sm:static sm:z-auto sm:rounded-2xl sm:border sm:border-[var(--border-default)] sm:shadow-[var(--shadow-md)]">
      {/* Card header — desktop rail only; the mobile bar leads straight with price */}
      <div className="hidden items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-6 py-3.5 sm:flex">
        <span className="font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          {isFree ? 'Register' : 'Get tickets'}
        </span>
        <span className="rounded-full bg-primary-50 px-2.5 py-1 font-mono text-2xs font-semibold uppercase tracking-wide text-[var(--text-brand)]">
          {priceLabel}
        </span>
      </div>

      <div className="px-5 py-3.5 sm:px-6 sm:py-5">
        {/* Price + CTA: one row on the mobile bar, stacked in the desktop card */}
        <div className="flex items-center gap-4 sm:flex-col sm:items-stretch">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-[var(--text-primary)] sm:font-display sm:text-2xl">
              {priceLabel}
            </span>
            {priceNote}
            {actionable && !confirmed && (
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500 shadow-[0_0_0_3px_var(--color-accent-50)]" />
                {status === 'almost_full' ? `Only ${seatsLeft} left` : `${seatsLeft} spots open`}
              </span>
            )}
          </div>

          <div className="ml-auto sm:ml-0">
            {status === 'ended' ? (
              <span className="block text-sm font-medium text-[var(--text-tertiary)] sm:py-1">
                This event has ended
              </span>
            ) : status === 'sold_out' || status === 'members_only' ? (
              <button
                disabled
                className="h-11 w-full cursor-not-allowed rounded-lg bg-[var(--color-neutral-200)] px-6 text-sm font-semibold text-[var(--text-tertiary)]"
              >
                {status === 'sold_out' ? 'Sold out' : 'For members'}
              </button>
            ) : confirmed ? (
              <span className="block text-sm font-semibold text-[var(--text-brand)] sm:py-1">
                You&rsquo;re going
              </span>
            ) : isFree ? (
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="focus-ring h-11 w-full rounded-lg bg-primary-600 px-6 text-sm font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-primary-700"
              >
                {ctaLabel}
              </button>
            ) : (
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="focus-ring h-11 w-full rounded-lg bg-accent-500 px-6 text-sm font-semibold text-[var(--color-accent-900)] shadow-[var(--shadow-accent)] transition-colors hover:bg-accent-600"
              >
                {ctaLabel}
              </button>
            )}
          </div>
        </div>

        {/* Members-only types: listed so non-members know they exist; the price note says what to do */}
        {membersOnlyTypes.length > 0 && status !== 'ended' && (
          <ul className="mt-3 grid gap-1.5 border-t border-[var(--border-subtle)] pt-3 text-sm">
            {membersOnlyTypes.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  {t.name} · {formatPrice(t.memberPriceCents ?? t.regularPriceCents)}
                </span>
                <span className="flex-none font-mono text-2xs font-semibold uppercase tracking-wide text-[var(--color-accent-900)]">
                  For members
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* One form: the selected type's price for this viewer picks RSVP or payment */}
        {actionable && open && !confirmed && selected && (
          <form action={freeChoice ? formAction : payAction} className="mt-4 grid gap-3">
            <input type="hidden" name="eventId" value={eventId} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Your name</span>
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="First and last name"
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  defaultValue={defaultEmail}
                  className={INPUT}
                />
              </label>
            </div>
            <div
              className={
                options.length > 1 ? 'grid gap-3 sm:grid-cols-[1fr_8rem] lg:grid-cols-[1fr_7rem]' : 'grid'
              }
            >
              {options.length > 1 ? (
                <label className="flex flex-col gap-1">
                  <span className={FIELD_LABEL}>Ticket</span>
                  <select
                    name="ticketTypeId"
                    required
                    value={selected.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                    className={INPUT}
                  >
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {formatPrice(t.effectivePriceCents)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="ticketTypeId" value={selected.id} />
              )}
              <label className="flex w-full flex-col gap-1 sm:max-w-[10rem] lg:max-w-none">
                <span className={FIELD_LABEL}>{freeChoice ? 'Guests (incl. you)' : 'Quantity'}</span>
                <input
                  name={freeChoice ? 'guests' : 'qty'}
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={1}
                  className={INPUT}
                />
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-[var(--color-error-200)] bg-[var(--color-error-50)] px-3 py-2 text-sm text-[var(--color-error-500)]"
              >
                {error}
              </p>
            )}

            {freeChoice ? (
              <>
                <button
                  type="submit"
                  disabled={pending}
                  className="focus-ring inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary-600 px-6 text-sm font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pending ? 'Reserving…' : 'Confirm RSVP'}
                </button>
                <p className="text-xs text-[var(--text-tertiary)]">
                  No account needed. We use your email only to hold your spot.
                </p>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={paying}
                  className="focus-ring inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent-500 px-6 text-sm font-semibold text-[var(--color-accent-900)] shadow-[var(--shadow-accent)] transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {paying ? 'Holding your seats…' : 'Continue to payment'}
                </button>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Your seats are held while you pay. Payment is handled securely by our processor;
                  we never see your card.
                </p>
              </>
            )}
          </form>
        )}

        {/* RSVP confirmation — a single gold sheen on the moment it lands */}
        {state && state.ok && (
          <div
            role="status"
            className="reg-shimmer mt-4 flex flex-col gap-2 rounded-lg bg-primary-50 px-3 py-2.5 text-sm text-[var(--text-brand)]"
          >
            <span>
              You&rsquo;re in, {state.name.split(' ')[0]}!{' '}
              {state.emailed
                ? `We emailed your ${state.guests === 1 ? 'ticket' : `${state.guests} tickets`}.`
                : `We saved ${state.guests === 1 ? 'your spot' : `${state.guests} spots`}; your ${
                    state.guests === 1 ? 'ticket is' : 'tickets are'
                  } ready.`}
            </span>
            {state.ticketUrl && (
              <a
                href={state.ticketUrl}
                className="focus-ring shrink-0 font-semibold underline underline-offset-4"
              >
                View {state.guests === 1 ? 'ticket' : 'your first ticket'} &rarr;
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
