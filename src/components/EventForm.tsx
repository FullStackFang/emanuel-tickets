'use client'

import { useActionState, useState } from 'react'
import { StatusPill } from '@/components/StatusPill'
import { meshFor, formatPrice } from '@/lib/event-format'

// Shared create/edit form. Both flows return the same state shape: success
// redirects server-side, so the only client-rendered state is a validation error.
export type EventFormState = { ok: false; error: string } | null

export type EventFormValues = {
  title: string
  date: string
  time: string
  location: string
  description: string
  category: string
  capacity: string
  priceMode: 'free' | 'paid'
  priceAmount: string
  memberPriceAmount: string // blank: no member price
  membersOnly: boolean
  publish: 'published' | 'draft'
}

const BLANK: EventFormValues = {
  title: '',
  date: '',
  time: '',
  location: '',
  description: '',
  category: '',
  capacity: '',
  priceMode: 'free',
  priceAmount: '',
  memberPriceAmount: '',
  membersOnly: false,
  publish: 'published',
}

// Shared field classes, matching the vocabulary in EventActionBar so host forms
// look identical to the public RSVP form.
const INPUT =
  'focus-ring h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]'
const FIELD_LABEL =
  'font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]'

// The fields the live preview reflects. Inputs stay uncontrolled (defaultValue +
// name) so the server action reads them straight off FormData; we only mirror
// their values into state to paint the preview.
type Preview = Pick<EventFormValues, 'title' | 'date' | 'time' | 'location' | 'category' | 'capacity'>

export function EventForm({
  action,
  initial = BLANK,
  eventId,
  submitLabel = 'Create event',
  pendingLabel = 'Creating…',
}: {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>
  initial?: EventFormValues
  eventId?: string
  submitLabel?: string
  pendingLabel?: string
}) {
  const [state, formAction, pending] = useActionState<EventFormState, FormData>(action, null)
  const [priceMode, setPriceMode] = useState<'free' | 'paid'>(initial.priceMode)
  const [priceAmount, setPriceAmount] = useState(initial.priceAmount)
  const [preview, setPreview] = useState<Preview>({
    title: initial.title,
    date: initial.date,
    time: initial.time,
    location: initial.location,
    category: initial.category,
    capacity: initial.capacity,
  })

  // One handler for the whole form: any field named in Preview updates the card.
  function onFormInput(e: React.FormEvent<HTMLFormElement>) {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    if (el?.name && el.name in preview) {
      setPreview((p) => ({ ...p, [el.name]: el.value }))
    }
  }

  return (
    <form action={formAction} onInput={onFormInput} className="grid gap-6">
      {eventId && <input type="hidden" name="id" value={eventId} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10">
        {/* ── The form ─────────────────────────────────────────────── */}
        <div className="grid gap-6">
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Event name</span>
            <input
              name="title"
              required
              maxLength={200}
              autoComplete="off"
              placeholder="Shabbat Dinner"
              defaultValue={initial.title}
              className={`${INPUT} font-display text-lg`}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Date</span>
              <input name="date" type="date" required defaultValue={initial.date} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Start time</span>
              <input
                name="time"
                type="time"
                required
                defaultValue={initial.time}
                className={`${INPUT} font-mono`}
              />
            </label>
          </div>
          <p className="-mt-3 text-xs text-[var(--text-tertiary)]">
            Times are Eastern (New York). End time isn&rsquo;t stored yet, so events show a
            2-hour default on calendar links.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Location</span>
            <input
              name="location"
              autoComplete="off"
              placeholder="Temple Emanu-El, or a virtual link"
              defaultValue={initial.location}
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Description</span>
            <textarea
              name="description"
              rows={4}
              placeholder="What should congregants know before they come?"
              defaultValue={initial.description}
              className={`${INPUT} h-auto resize-y py-2 leading-relaxed`}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Category</span>
              <input
                name="category"
                autoComplete="off"
                placeholder="Talk, Concert, Service…"
                defaultValue={initial.category}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Capacity</span>
              <input
                name="capacity"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="No limit"
                defaultValue={initial.capacity}
                className={INPUT}
              />
            </label>
          </div>

          {/* Ticket price: free by default. Paid reveals an amount; note that paid
              checkout itself is not wired yet (the event page stubs it). */}
          <fieldset className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <legend className={`${FIELD_LABEL} px-1`}>Ticket price</legend>
            <div className="flex gap-2">
              <PriceOption current={priceMode} value="free" onSelect={setPriceMode} label="Free" />
              <PriceOption current={priceMode} value="paid" onSelect={setPriceMode} label="Paid" />
            </div>
            <input type="hidden" name="priceMode" value={priceMode} />
            {priceMode === 'paid' && (
              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Price per ticket (USD)</span>
                <input
                  name="priceAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="18.00"
                  value={priceAmount}
                  onChange={(e) => setPriceAmount(e.target.value)}
                  className={`${INPUT} sm:max-w-40`}
                />
                <span className="text-xs text-[var(--text-tertiary)]">
                  Online payment isn&rsquo;t live yet; paid events save but can&rsquo;t sell until
                  checkout is wired.
                </span>
              </label>
            )}
            {priceMode === 'paid' && (
              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Member price (USD, optional)</span>
                <input
                  name="memberPriceAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Same as above"
                  defaultValue={initial.memberPriceAmount}
                  className={`${INPUT} sm:max-w-40`}
                />
                <span className="text-xs text-[var(--text-tertiary)]">
                  Signed-in members pay this instead. Enter 0 to make it free for members.
                </span>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                name="membersOnly"
                type="checkbox"
                defaultChecked={initial.membersOnly}
                className="focus-ring h-4 w-4"
              />
              Members only
              <span className="text-xs text-[var(--text-tertiary)]">
                (hidden from guests and non-members)
              </span>
            </label>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Visibility</span>
            <select name="publish" defaultValue={initial.publish} className={INPUT}>
              <option value="published">Publish now (listed publicly)</option>
              <option value="draft">Save as draft (hidden)</option>
            </select>
          </label>
        </div>

        {/* ── The live front door ──────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <EventPreview {...preview} priceMode={priceMode} priceAmount={priceAmount} />
        </div>
      </div>

      {state && !state.ok && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-error-200)] bg-[var(--color-error-50)] px-3 py-2 text-sm text-[var(--color-error-500)]"
        >
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="focus-ring inline-flex h-11 items-center justify-center rounded-lg bg-primary-600 px-6 text-sm font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <a
          href="/dashboard"
          className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}

// Dim overlay + a stable stained-glass mesh, matching EventCard. The real cover
// hue is picked from the event id at publish time; this representative one keeps
// the preview calm instead of reshuffling on every keystroke.
const DIM = 'linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.42))'
const PREVIEW_MESH = meshFor('emanuel-gather-preview')

// The host enters wall-clock Eastern time, so we format those literal values.
// This yields the same string the public page shows (which converts the stored
// UTC instant back to America/New_York).
function previewWhen(date: string, time: string): { text: string; muted: boolean } {
  if (!date) return { text: 'Date to be announced', muted: true }
  const d = new Date(`${date}T${time || '00:00'}`)
  if (Number.isNaN(d.getTime())) return { text: 'Date to be announced', muted: true }
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)
  if (!time) return { text: day, muted: false }
  const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d)
  return { text: `${day} · ${t}`, muted: false }
}

function EventPreview({
  title,
  date,
  time,
  location,
  category,
  priceMode,
  priceAmount,
}: Preview & { priceMode: 'free' | 'paid'; priceAmount: string }) {
  const when = previewWhen(date, time)
  const dollars = Number.parseFloat(priceAmount)
  const price =
    priceMode === 'free'
      ? 'Free'
      : Number.isFinite(dollars) && dollars > 0
        ? formatPrice(Math.round(dollars * 100))
        : 'Paid'

  return (
    <div className="grid gap-2">
      <span className={`${FIELD_LABEL} flex items-center gap-2`}>
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success-500)] shadow-[0_0_0_3px_var(--color-success-50)]"
        />
        Live preview
      </span>

      {/* Mirrors the public EventCard poster so hosts see exactly what
          congregants will. */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-[var(--shadow-sm)]">
        <div className="relative aspect-[4/3] overflow-hidden" style={{ background: PREVIEW_MESH }}>
          <div className="absolute inset-0" style={{ background: DIM }} />
          {category.trim() && (
            <span className="absolute left-3 top-3 z-10 inline-flex items-center rounded-full border border-white/40 bg-black/25 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-white backdrop-blur-sm">
              {category.trim()}
            </span>
          )}
          <div className="absolute right-3 top-3 z-10">
            <StatusPill status="available" variant="cover" />
          </div>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <span
            className={`font-mono text-2xs uppercase tracking-wider ${
              when.muted ? 'text-[var(--text-tertiary)]/70' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {when.text}
          </span>
          <h3
            className={`line-clamp-2 font-display text-base font-semibold leading-snug ${
              title.trim() ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {title.trim() || 'Untitled event'}
          </h3>
          {location.trim() && (
            <span className="line-clamp-1 text-xs text-[var(--text-secondary)]">
              {location.trim()}
            </span>
          )}
          <span className="mt-1 pt-1.5 text-sm font-semibold text-[var(--text-primary)]">{price}</span>
        </div>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        This is what congregants see. Cover art is assigned when you publish.
      </p>
    </div>
  )
}

function PriceOption({
  current,
  value,
  label,
  onSelect,
}: {
  current: 'free' | 'paid'
  value: 'free' | 'paid'
  label: string
  onSelect: (v: 'free' | 'paid') => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`focus-ring h-9 flex-1 rounded-lg border px-4 text-sm font-medium transition-colors ${
        active
          ? 'border-transparent bg-primary-600 text-white shadow-[var(--shadow-primary)]'
          : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  )
}
