import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/db'
import { SubscriptionStatus } from '@/lib/generated/prisma/client'
import logger from '@/lib/logger'

/**
 * Each `reason` names a distinct fault, because they call for different
 * responses and collapsing them makes the logs lie about which happened:
 *
 * - `no_organization` — the Stripe object carries no `organizationId` at all.
 *   Usually a subscription created outside checkout.
 * - `unknown_organization` — it names one that does not exist here. A deleted
 *   organization, or an id typed by hand in the Stripe dashboard.
 * - `unknown_price` — the price maps to no `Plan`. Configuration drift.
 * - `no_billing_period` — the object carries no period. A malformed or very
 *   old event payload, not a configuration problem.
 */
export type SyncResult =
  | { handled: true; organizationId: string; status: SubscriptionStatus }
  | {
      handled: false
      reason: 'no_organization' | 'unknown_organization' | 'unknown_price' | 'no_billing_period'
    }

/**
 * Statuses that mean "this organization is entitled to its paid plan".
 *
 * `past_due` is in the list deliberately. Stripe retries a failed card on its
 * own schedule for roughly three weeks, and dropping a customer to `free` on
 * the first decline would stop their mail over an expired card — a support
 * incident and a churn event caused by our own impatience. Entitlement ends
 * when Stripe gives up and the subscription is deleted, not when a charge
 * bounces.
 */
const ENTITLED: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due,
])

/**
 * Narrows Stripe's eight statuses onto the four this app stores.
 *
 * Everything unrecognised maps to `canceled`, which is the only safe default:
 * the failure mode of guessing wrong in the other direction is serving paid
 * limits to someone who is not paying, and Stripe can add statuses without
 * asking us.
 *
 * - `incomplete` / `incomplete_expired` — the first payment never succeeded, so
 *   the customer was never entitled.
 * - `unpaid` — Stripe finished its retry schedule and gave up.
 * - `paused` — collection is stopped.
 */
export function mapSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return SubscriptionStatus.active
    case 'trialing':
      return SubscriptionStatus.trialing
    case 'past_due':
      return SubscriptionStatus.past_due
    default:
      return SubscriptionStatus.canceled
  }
}

export function isEntitled(status: SubscriptionStatus): boolean {
  return ENTITLED.has(status)
}

/**
 * Stripe moved the billing window onto the subscription *item* in recent API
 * versions, so it is read from the first item rather than the subscription.
 * Falling back to the subscription's own fields keeps this working against an
 * older event replayed from Stripe's history.
 */
function billingWindow(subscription: Stripe.Subscription): { start: Date; end: Date } | null {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined
  const legacy = subscription as unknown as {
    current_period_start?: number
    current_period_end?: number
  }

  const start = item?.current_period_start ?? legacy.current_period_start
  const end = item?.current_period_end ?? legacy.current_period_end
  if (typeof start !== 'number' || typeof end !== 'number') return null

  return { start: new Date(start * 1000), end: new Date(end * 1000) }
}

/**
 * Brings the local `Subscription` row in line with a Stripe subscription object
 * (issue #120 §5).
 *
 * Written to be safe under Stripe's two awkward guarantees:
 *
 * - **Replay.** Every write here is an upsert or a delete keyed on the
 *   organization, so a redelivered event produces the same end state rather
 *   than a duplicate row or a constraint violation. No "have I seen this event"
 *   table is needed.
 * - **Out-of-order delivery.** Nothing here assumes a sequence — the object
 *   carries its own current state, so a `subscription.updated` arriving before
 *   the `checkout.session.completed` that created it still lands correctly.
 *
 * **Never throws for data reasons.** A non-2xx makes Stripe retry, and an event
 * we structurally cannot handle would retry until Stripe disables the endpoint
 * — which would stop subscription events for every customer, not just the one
 * whose event was bad. Unhandleable events are reported and acknowledged.
 *
 * Infrastructure faults still throw, and should: a database outage is exactly
 * when a retry is wanted. The one residual data-shaped throw is a TOCTOU — the
 * organization being deleted between the existence check and a write below —
 * which is self-healing, since Stripe's retry then takes the no-op path.
 */
export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
): Promise<SyncResult> {
  const organizationId = subscription.metadata?.organizationId
  if (!organizationId) {
    logger.warn(
      { stripeSubscriptionId: subscription.id },
      'Stripe subscription carries no organizationId; ignoring',
    )
    return { handled: false, reason: 'no_organization' }
  }

  const status = mapSubscriptionStatus(subscription.status)

  // Checked before any write. The organization named in Stripe metadata can be
  // gone — deleted here, or an id typed by hand into the Stripe dashboard — and
  // `prisma.organization.update` throws P2025 on a missing row. That would
  // surface as a 500 from the webhook, and Stripe disables an endpoint that
  // keeps failing: one deleted organization would stop subscription events
  // arriving for *every* customer. A reported no-op is the only safe answer.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  })
  if (!organization) {
    logger.warn(
      { organizationId, stripeSubscriptionId: subscription.id },
      'Stripe subscription names an organization that does not exist here; ignoring',
    )
    return { handled: false, reason: 'unknown_organization' }
  }

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

  // Recorded even on the terminal path, so a returning customer reuses their
  // Stripe record rather than getting a second one.
  if (customerId) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customerId },
    })
  }

  // A terminal status removes the row rather than storing `canceled`. The
  // resolver falls back to `free` on *absence*; a lingering row still pointing
  // at `pro` would keep serving paid limits to someone who stopped paying.
  if (!isEntitled(status)) {
    await prisma.subscription.deleteMany({ where: { organizationId } })
    logger.info(
      { organizationId, stripeSubscriptionId: subscription.id, stripeStatus: subscription.status },
      'Subscription ended; organization falls back to the default plan',
    )
    return { handled: true, organizationId, status }
  }

  // Resolved from the price rather than from metadata: metadata is writable in
  // the Stripe dashboard, the price is what the customer is actually billed
  // for. They must not be able to disagree.
  const priceId = subscription.items?.data?.[0]?.price?.id
  const plan = priceId
    ? await prisma.plan.findUnique({ where: { stripePriceId: priceId } })
    : null

  if (!plan) {
    logger.warn(
      { organizationId, stripeSubscriptionId: subscription.id, priceId },
      'Stripe subscription price maps to no plan; ignoring',
    )
    return { handled: false, reason: 'unknown_price' }
  }

  const window = billingWindow(subscription)
  if (!window) {
    logger.warn(
      { organizationId, stripeSubscriptionId: subscription.id },
      'Stripe subscription carries no billing period; ignoring',
    )
    // Distinct from `unknown_price`: the price resolved fine, the payload is
    // malformed or predates the field moving onto the subscription item.
    return { handled: false, reason: 'no_billing_period' }
  }

  const shared = {
    planId: plan.id,
    status,
    currentPeriodStart: window.start,
    currentPeriodEnd: window.end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    externalId: subscription.id,
  }

  await prisma.subscription.upsert({
    where: { organizationId },
    create: { organizationId, ...shared },
    update: shared,
  })

  logger.info(
    { organizationId, planCode: plan.code, status, stripeSubscriptionId: subscription.id },
    'Subscription synced from Stripe',
  )

  return { handled: true, organizationId, status }
}
