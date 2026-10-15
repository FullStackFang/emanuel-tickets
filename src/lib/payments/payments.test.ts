// Unit tests for the provider seam: no network, no DB.
//   node --test --experimental-strip-types src/lib/payments/payments.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signFakeBody, verifyFakeSignature } from './fake.ts'
import { mapStripeEvent } from './stripe.ts'

test('fake signature round-trips and rejects tampering', () => {
  const body = JSON.stringify({ eventId: 'evt_1', ref: 'fake_r', status: 'paid', amountCents: 3600 })
  const sig = signFakeBody(body, 's3cret')
  assert.equal(verifyFakeSignature(body, sig, 's3cret'), true)
  assert.equal(verifyFakeSignature(body + ' ', sig, 's3cret'), false)
  assert.equal(verifyFakeSignature(body, sig, 'other'), false)
  assert.equal(verifyFakeSignature(body, null, 's3cret'), false)
  assert.equal(verifyFakeSignature(body, 'zz', 's3cret'), false)
})

const session = (over: Record<string, unknown>) => ({
  id: 'cs_test_1',
  amount_total: 3600,
  payment_status: 'paid',
  status: 'complete',
  ...over,
})
const evt = (type: string, object: unknown) => ({ id: 'evt_x', type, data: { object } }) as never

test('mapStripeEvent normalizes the checkout lifecycle', () => {
  assert.deepEqual(mapStripeEvent(evt('checkout.session.completed', session({}))), {
    providerEventId: 'evt_x',
    providerRef: 'cs_test_1',
    status: 'paid',
    amountCents: 3600,
  })
  assert.equal(
    mapStripeEvent(evt('checkout.session.completed', session({ payment_status: 'unpaid' })))?.status,
    'pending',
  )
  assert.equal(mapStripeEvent(evt('checkout.session.async_payment_succeeded', session({})))?.status, 'paid')
  assert.equal(mapStripeEvent(evt('checkout.session.async_payment_failed', session({})))?.status, 'failed')
  assert.equal(
    mapStripeEvent(evt('checkout.session.expired', session({ status: 'expired' })))?.status,
    'expired',
  )
  assert.equal(mapStripeEvent(evt('payment_intent.created', {})), null)
})
