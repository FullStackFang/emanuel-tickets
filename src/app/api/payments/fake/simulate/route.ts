// Dev-only: the fake processor's "Pay" button. Signs a webhook body exactly as
// a real processor would and delivers it to our real webhook route over HTTP,
// then sends the buyer to the success or cancel URL. Never available in prod.

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  FAKE_SIGNATURE_HEADER,
  fakeSession,
  setFakeSessionStatus,
  signFakeBody,
  type FakeWebhookBody,
} from '@/lib/payments/fake'
import type { PaymentStatus } from '@/lib/payments'

const OUTCOMES = new Set<PaymentStatus>(['paid', 'failed', 'expired', 'refunded'])

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response('not found', { status: 404 })
  const form = await req.formData()
  const ref = String(form.get('ref') ?? '')
  const status = String(form.get('status') ?? '') as PaymentStatus
  const session = fakeSession(ref)
  if (!session || !OUTCOMES.has(status)) return new Response('bad request', { status: 400 })

  const body: FakeWebhookBody = {
    eventId: `fevt_${randomUUID()}`,
    ref,
    status,
    amountCents: session.amountCents,
  }
  const raw = JSON.stringify(body)
  // Everything stays on the origin that served this request: a dev server rarely
  // matches NEXT_PUBLIC_SITE_URL, and the fake must never bounce to production.
  const origin = new URL(req.url).origin
  const local = (u: string) => new URL(new URL(u).pathname, origin).toString()
  const res = await fetch(`${origin}/api/payments/fake/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signFakeBody(raw) },
    body: raw,
  })
  if (!res.ok) return new Response(`webhook responded ${res.status}`, { status: 502 })

  setFakeSessionStatus(ref, status)
  return NextResponse.redirect(local(status === 'paid' ? session.successUrl : session.cancelUrl), 303)
}
