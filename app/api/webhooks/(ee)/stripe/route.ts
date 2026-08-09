import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { withPublic } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { getStripe } from '@/ee/billing/client'
import { syncSubscriptionFromStripe } from '@/ee/billing/subscription-sync'

/**
 * Events this route acts on. Everything else is acknowledged and ignored —
 * Stripe lets you subscribe to more than you handle, and a 4xx on an
 * unrecognised type makes it retry forever and eventually disable the endpoint.
 */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

/**
 * Stripe's subscription webhook (issue #120 §5).
 *
 * `withPublic` for the same reason as the Resend ingest: Stripe has no bearer
 * credential to present, so the *request* is authenticated by signature rather
 * than the caller.
 *
 * Returns 200 for everything it cannot act on. The only non-2xx is a failed
 * signature check (400) — a request that is not from Stripe — and an
 * unexpected internal fault (500), which is the one case where a retry is
 * genuinely wanted.
 */
export const POST = withPublic(async (request: NextRequest) => {
  // 404 rather than 503: a feature that is off should not advertise that it
  // exists, matching how `/api/mcp` behaves when ENABLE_MCP is unset.
  if (!config.commercial.enabled) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 })
  }

  const webhookSecret = config.commercial.stripeWebhookSecret
  if (!webhookSecret) {
    // Unreachable: assertConfig() refuses to boot without this when the
    // commercial layer is on. Guarded anyway so a misconfiguration cannot
    // become an unverified webhook.
    logger.error({}, 'Stripe webhook received but STRIPE_WEBHOOK_SECRET is unset')
    return NextResponse.json({ message: 'Not configured' }, { status: 500 })
  }

  // The raw body, before anything parses it. `constructEvent` verifies a
  // signature over the exact bytes Stripe sent, so a re-serialised object would
  // fail even when the content is identical.
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature ?? '', webhookSecret.reveal())
  } catch (error) {
    // Deliberately not logging the body or the signature: an unverified request
    // is attacker-controlled input, and the header is a keyed MAC.
    logger.warn({ error }, 'Invalid Stripe webhook signature')
    return NextResponse.json({ message: 'Invalid signature' }, { status: 400 })
  }

  if (!HANDLED.has(event.type)) {
    logger.info({ eventType: event.type, eventId: event.id }, 'Unhandled Stripe event acknowledged')
    return NextResponse.json({ received: true })
  }

  try {
    await handleEvent(event)
  } catch (error) {
    // A genuine fault — a database outage, say. 500 so Stripe retries, which is
    // exactly what should happen when the failure is ours and transient.
    logger.error({ error, eventType: event.type, eventId: event.id }, 'Stripe webhook handling failed')
    return NextResponse.json({ message: 'Webhook handling failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
})

async function handleEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe()

  switch (event.type) {
    // The subscription object carries its own current state, so all three
    // lifecycle events go through one path. That is also what makes
    // out-of-order delivery safe: nothing here infers a sequence.
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription)
      return

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (!subscriptionId) {
        logger.info({ eventId: event.id }, 'Checkout session completed with no subscription')
        return
      }

      // Re-fetched rather than trusted from the session: the session's copy is
      // a snapshot from before payment settled, and this is the object the
      // whole entitlement decision rests on.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)

      // The organization comes from the session — checkout is where we set it,
      // and Stripe does not copy metadata onto the subscription automatically.
      const organizationId =
        session.metadata?.organizationId ?? session.client_reference_id ?? undefined
      if (organizationId && !subscription.metadata?.organizationId) {
        subscription.metadata = { ...subscription.metadata, organizationId }
        // Persisted so every later subscription event carries it without
        // needing the original session.
        await stripe.subscriptions.update(subscriptionId, {
          metadata: { organizationId },
        })
      }

      await syncSubscriptionFromStripe(subscription)
      return
    }

    // Both carry the subscription only by id, so the object is re-read and the
    // shared path decides. `invoice.paid` is what moves an organization back out
    // of `past_due` once a retry succeeds.
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | { id: string } | null
      }
      const subscriptionId =
        typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
      if (!subscriptionId) return

      await syncSubscriptionFromStripe(await stripe.subscriptions.retrieve(subscriptionId))
      return
    }
  }
}
