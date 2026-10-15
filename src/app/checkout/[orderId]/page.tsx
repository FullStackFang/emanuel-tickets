import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import { settleOrderFromReturn } from '@/lib/checkout'
import { createAdminClient } from '@/lib/supabase/admin'

// Post-payment return page. The provider is asked directly, so the buyer sees a
// result even if the webhook is late; fulfilment goes through the same idempotent
// path the webhook uses, so the two can never double-commit.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Your order · Emanuel Tickets',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CheckoutReturnPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  if (!UUID_RE.test(orderId)) notFound()
  const result = await settleOrderFromReturn(orderId)
  if (!result) notFound()

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('orders')
    .select('qty, buyer_email, buyer_name, event_id, events(title)')
    .eq('id', orderId)
    .maybeSingle()
  const order = data as
    | { qty: number; buyer_email: string; buyer_name: string | null; event_id: string; events: { title: string } | { title: string }[] | null }
    | null
  const ev = Array.isArray(order?.events) ? order?.events[0] : order?.events
  const title = ev?.title ?? 'your event'
  const firstName = order?.buyer_name?.split(' ')[0]
  const plural = (order?.qty ?? 1) > 1

  let heading: string
  let body: string
  if (result.status === 'confirmed' && result.needsRefund) {
    heading = 'We received your payment, but the seats were gone'
    body = `Your hold for ${title} expired before the payment finished and the seats were resold. We will refund you in full; no action is needed.`
  } else if (result.status === 'confirmed') {
    heading = firstName ? `You’re in, ${firstName}!` : 'You’re in!'
    body = `Your ${plural ? `${order?.qty} tickets` : 'ticket'} for ${title} ${plural ? 'are' : 'is'} confirmed. We sent ${plural ? 'them' : 'it'} to ${order?.buyer_email}.`
  } else if (result.status === 'pending') {
    heading = 'Payment is still processing'
    body = `We are waiting for the payment confirmation for ${title}. Refresh in a moment; your tickets will also arrive by email at ${order?.buyer_email}.`
  } else {
    heading = 'This order was not completed'
    body = `The payment for ${title} did not go through and the seats were released. You can try again from the event page.`
  }

  return (
    <>
      <SiteHeader wide />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 sm:px-6">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-6 shadow-[var(--shadow-md)] sm:p-8">
          <p className="font-mono text-2xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Order
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[var(--text-primary)]">
            {heading}
          </h1>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">{body}</p>
          {result.ticketUrls.length > 0 && (
            <ul className="mt-5 grid gap-2">
              {result.ticketUrls.map((u, i) => (
                <li key={u}>
                  <a href={u} className="focus-ring font-semibold text-[var(--text-brand)] underline underline-offset-4">
                    View ticket{result.ticketUrls.length > 1 ? ` ${i + 1}` : ''} &rarr;
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            <Link
              href={order ? `/e/${order.event_id}` : '/'}
              className="focus-ring inline-flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <span aria-hidden>&larr;</span> Back to the event
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
