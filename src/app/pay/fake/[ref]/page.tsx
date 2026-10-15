import { notFound } from 'next/navigation'
import { fakeSession } from '@/lib/payments/fake'
import { formatPrice } from '@/lib/event-format'

export const dynamic = 'force-dynamic'

// The fake processor's "hosted checkout page". Dev and test only.
export default async function FakePayPage({ params }: { params: Promise<{ ref: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { ref } = await params
  const session = fakeSession(ref)
  if (!session) notFound()

  const btn =
    'focus-ring h-11 rounded-lg px-5 text-sm font-semibold transition-colors'
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] p-6">
        <p className="font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Fake payment processor · dev only
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-[var(--text-primary)]">
          {session.description}
        </h1>
        <p className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">
          {formatPrice(session.amountCents)}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Status: <span className="font-mono">{session.status}</span>
        </p>
        <form method="post" action="/api/payments/fake/simulate" className="mt-6 grid gap-2">
          <input type="hidden" name="ref" value={ref} />
          <button name="status" value="paid" className={`${btn} bg-primary-600 text-white hover:bg-primary-700`}>
            Pay {formatPrice(session.amountCents)}
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button name="status" value="failed" className={`${btn} border border-[var(--border-default)]`}>
              Fail
            </button>
            <button name="status" value="expired" className={`${btn} border border-[var(--border-default)]`}>
              Expire
            </button>
            <button name="status" value="refunded" className={`${btn} border border-[var(--border-default)]`}>
              Refund
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
