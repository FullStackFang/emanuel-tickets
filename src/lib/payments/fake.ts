// Fake provider for dev and tests. Proves the seam: it exercises the real
// checkout -> redirect -> signed webhook -> fulfil path with no processor account.
// The "hosted page" is our own /pay/fake/[ref] route; "Pay" signs an event with
// FAKE_PAYMENTS_SECRET (HMAC-SHA256) and POSTs it to the real webhook route.
// Refuses to run in production.

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  WebhookSignatureError,
  type CheckoutInput,
  type CheckoutStart,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
} from './provider.ts'

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature'

export function fakeSecret(): string {
  if (process.env.NODE_ENV === 'production')
    throw new Error('fake payment provider is not allowed in production')
  return process.env.FAKE_PAYMENTS_SECRET ?? 'dev-only-fake-secret'
}

export function signFakeBody(body: string, secret = fakeSecret()): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function verifyFakeSignature(
  body: string,
  signature: string | null,
  secret = fakeSecret(),
): boolean {
  if (!signature) return false
  const expected = Buffer.from(signFakeBody(body, secret), 'hex')
  const given = Buffer.from(signature, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Body shape the fake "processor" sends. Status is anything a real one could.
export type FakeWebhookBody = {
  eventId: string
  ref: string
  status: PaymentStatus
  amountCents: number | null
}

export type FakeSession = {
  orderId: string
  amountCents: number
  description: string
  successUrl: string
  cancelUrl: string
  status: PaymentStatus
}

// In-memory session table; good enough for a dev server (lost on restart, which
// is fine: the hold expires and the sweep releases it). Hung on globalThis so
// Next dev's module reloads do not wipe it between requests.
const g = globalThis as unknown as { __fakePaySessions?: Map<string, FakeSession> }
const sessions = (g.__fakePaySessions ??= new Map<string, FakeSession>())

export function fakeSession(ref: string): FakeSession | null {
  return sessions.get(ref) ?? null
}
export function setFakeSessionStatus(ref: string, status: PaymentStatus) {
  const s = sessions.get(ref)
  if (s) s.status = status
}

export const fakeProvider: PaymentProvider = {
  id: 'fake',

  async createCheckout(input: CheckoutInput): Promise<CheckoutStart> {
    fakeSecret() // production guard
    const ref = `fake_${input.idempotencyKey}`
    if (!sessions.has(ref))
      sessions.set(ref, {
        orderId: input.orderId,
        amountCents: input.amountCents,
        description: input.description,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        status: 'pending',
      })
    // Relative on purpose: dev servers rarely match NEXT_PUBLIC_SITE_URL.
    return { kind: 'redirect', url: `/pay/fake/${ref}`, providerRef: ref }
  },

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    if (!verifyFakeSignature(rawBody, headers.get(FAKE_SIGNATURE_HEADER)))
      throw new WebhookSignatureError()
    const body = JSON.parse(rawBody) as FakeWebhookBody
    return {
      providerEventId: body.eventId,
      providerRef: body.ref,
      status: body.status,
      amountCents: body.amountCents,
    }
  },

  async getStatus(providerRef: string): Promise<PaymentStatus> {
    return sessions.get(providerRef)?.status ?? 'pending'
  },

  async refund(providerRef: string): Promise<void> {
    setFakeSessionStatus(providerRef, 'refunded')
  },
}
