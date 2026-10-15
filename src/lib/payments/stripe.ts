// Stripe behind the PaymentProvider seam: hosted Checkout Sessions (SAQ A).
// The ONLY module that imports the Stripe SDK.

import Stripe from 'stripe'
import {
  WebhookSignatureError,
  type CheckoutInput,
  type CheckoutStart,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
} from './provider.ts'

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(key)
}

// Pure mapping from a verified Stripe event to our normalized event, kept
// separate so it can be unit-tested without network or a signing secret.
export function mapStripeEvent(event: Stripe.Event): PaymentEvent | null {
  const base = { providerEventId: event.id }
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object
      // Card payments are 'paid' here; ACH/bank debits complete asynchronously
      // and arrive later as async_payment_succeeded / failed.
      const status: PaymentStatus = s.payment_status === 'paid' ? 'paid' : 'pending'
      return { ...base, providerRef: s.id, status, amountCents: s.amount_total }
    }
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object
      return { ...base, providerRef: s.id, status: 'paid', amountCents: s.amount_total }
    }
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object
      return { ...base, providerRef: s.id, status: 'failed', amountCents: s.amount_total }
    }
    case 'checkout.session.expired': {
      const s = event.data.object
      return { ...base, providerRef: s.id, status: 'expired', amountCents: s.amount_total }
    }
    default:
      return null
  }
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',

  async createCheckout(input: CheckoutInput): Promise<CheckoutStart> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: input.buyerEmail,
        client_reference_id: input.orderId,
        metadata: { order_id: input.orderId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: input.description },
            },
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Stripe requires 30 min..24 h from creation; the caller sizes the hold
        // so this is always inside that window.
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: input.idempotencyKey },
    )
    if (!session.url) throw new Error('Stripe returned a Checkout Session without a url')
    return { kind: 'redirect', url: session.url, providerRef: session.id }
  },

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set')
    const sig = headers.get('stripe-signature')
    if (!sig) throw new WebhookSignatureError('missing stripe-signature header')
    let event: Stripe.Event
    try {
      event = await stripe().webhooks.constructEventAsync(rawBody, sig, secret)
    } catch (err) {
      throw new WebhookSignatureError(err instanceof Error ? err.message : 'bad signature')
    }
    return mapStripeEvent(event)
  },

  async getStatus(providerRef: string): Promise<PaymentStatus> {
    const s = await stripe().checkout.sessions.retrieve(providerRef)
    if (s.payment_status === 'paid') return 'paid'
    if (s.status === 'expired') return 'expired'
    return 'pending'
  },

  async refund(providerRef: string, amountCents?: number): Promise<void> {
    const s = await stripe().checkout.sessions.retrieve(providerRef)
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id
    if (!pi) throw new Error(`Checkout Session ${providerRef} has no payment intent to refund`)
    await stripe().refunds.create(
      { payment_intent: pi, ...(amountCents != null ? { amount: amountCents } : {}) },
      { idempotencyKey: `refund:${providerRef}:${amountCents ?? 'full'}` },
    )
  },
}
