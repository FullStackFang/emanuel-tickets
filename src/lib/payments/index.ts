// Provider registry. PAYMENT_PROVIDER picks the active module for new checkouts;
// webhooks are routed by the provider id in their URL so an old provider's
// events (refunds, late payments) still land after a switch.

import type { PaymentProvider } from './provider.ts'

export * from './provider.ts'

const registry: Record<string, () => Promise<PaymentProvider>> = {
  stripe: () => import('./stripe.ts').then((m) => m.stripeProvider),
  fake: () => import('./fake.ts').then((m) => m.fakeProvider),
}

export function activeProviderId(): string {
  const id = process.env.PAYMENT_PROVIDER?.trim()
  if (id) return id
  if (process.env.STRIPE_SECRET_KEY) return 'stripe'
  if (process.env.NODE_ENV !== 'production') return 'fake'
  throw new Error('PAYMENT_PROVIDER is not set')
}

export async function getPaymentProvider(
  id: string = activeProviderId(),
): Promise<PaymentProvider> {
  const load = registry[id]
  if (!load) throw new Error(`unknown payment provider: ${id}`)
  return load()
}

export function isKnownProvider(id: string): boolean {
  return Object.hasOwn(registry, id)
}
