// Payment-provider seam (design D9). The rest of the app talks ONLY to this
// contract; a vendor SDK is imported by exactly one module under ./payments.
// Swapping or adding a processor = one new module + PAYMENT_PROVIDER env.
//
// Two checkout shapes exist in the wild and both keep card data off our servers
// (PCI SAQ A):
//   * 'redirect'  -- a provider-hosted page (Stripe Checkout, Square links,
//                    Authorize.net Accept Hosted, PayPal). Buyer leaves our site.
//   * 'embedded'  -- provider-hosted card fields inside our page (Braintree,
//                    Helcim). The server mints a client token; a small per-provider
//                    client component renders the fields. No implementation yet.

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'expired' | 'refunded'

export type CheckoutInput = {
  orderId: string
  amountCents: number
  currency: 'usd'
  description: string
  buyerEmail: string
  successUrl: string
  cancelUrl: string
  // Derived from the reservation, so a repeated call for the same hold creates
  // one provider session, not two.
  idempotencyKey: string
  // The provider session must not outlive the seat hold.
  expiresAt: Date
}

export type CheckoutStart =
  | { kind: 'redirect'; url: string; providerRef: string }
  | { kind: 'embedded'; clientToken: string; providerRef: string }

// One normalized provider event. providerEventId is unique per provider; the
// webhook route prefixes it with the provider id before it hits the ledger so
// two vendors can never collide.
export type PaymentEvent = {
  providerEventId: string
  providerRef: string
  status: PaymentStatus
  amountCents: number | null
}

export class WebhookSignatureError extends Error {
  constructor(message = 'invalid webhook signature') {
    super(message)
    this.name = 'WebhookSignatureError'
  }
}

export interface PaymentProvider {
  readonly id: string
  createCheckout(input: CheckoutInput): Promise<CheckoutStart>
  // Verify the signature over the RAW request body and normalize the event.
  // Throws WebhookSignatureError (-> 4xx, no state change) on a bad signature.
  // Resolves to null for event types we do not act on (-> 2xx, no-op).
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>
  // Authoritative status for the post-payment return page and reconciliation.
  getStatus(providerRef: string): Promise<PaymentStatus>
  refund(providerRef: string, amountCents?: number): Promise<void>
}
