// Payment webhook, one URL per provider: /api/payments/<provider>/webhook.
// Spec ticket-checkout: bad signature -> 4xx with no state change; duplicate
// delivery -> 2xx no-op (ledger in confirm_order); order not found -> 5xx so
// the provider retries after our checkout transaction lands.

import { getPaymentProvider, isKnownProvider, WebhookSignatureError } from '@/lib/payments'
import { applyPaymentEvent, OrderNotFoundError } from '@/lib/checkout'

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params
  if (!isKnownProvider(providerId)) return new Response('unknown provider', { status: 404 })
  const provider = await getPaymentProvider(providerId)

  // Signature is computed over the raw bytes; do not parse before verifying.
  const rawBody = await req.text()
  let event
  try {
    event = await provider.parseWebhook(rawBody, req.headers)
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response('bad signature', { status: 400 })
    throw err
  }
  if (!event) return Response.json({ received: true, ignored: true })

  try {
    const result = await applyPaymentEvent(providerId, event)
    return Response.json({ received: true, orderId: result.orderId, status: result.status })
  } catch (err) {
    if (err instanceof OrderNotFoundError) return new Response('order not ready', { status: 503 })
    throw err
  }
}
