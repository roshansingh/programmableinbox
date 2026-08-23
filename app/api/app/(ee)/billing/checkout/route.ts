import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config, requireAppBaseUrl } from '@/lib/config'
import logger from '@/lib/logger'
import { getStripe } from '@/ee/billing/client'

/**
 * Roles that may commit the organization to a paid plan.
 *
 * A `member` or `viewer` starting a subscription would be spending someone
 * else's money — the same reasoning that keeps mutation on `OwnerScope`
 * elsewhere in the codebase.
 */
const BILLING_ROLES = new Set(['owner', 'admin'])

/**
 * Starts a Stripe Checkout session for a plan (issue #120 §4).
 *
 * Returns the session URL rather than redirecting: the caller is
 * `lib/api-client.ts`, which follows redirects transparently and would leave
 * the browser on an opaque response.
 */
export const POST = withUser(async (request: NextRequest, principal) => {
  if (!config.commercial.enabled) {
    return jsonError('Not found', 404)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonError('Invalid request body', 400)
  }

  const { organizationId, planCode } = body as { organizationId?: unknown; planCode?: unknown }
  if (typeof organizationId !== 'string' || typeof planCode !== 'string') {
    return jsonError('organizationId and planCode are required', 400)
  }

  // The membership check lives in `toOrgScope`, as everywhere else — this route
  // must not become a second, weaker tenancy predicate.
  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  const membership = principal.memberships.find((m) => m.organizationId === organizationId)
  if (!membership || !BILLING_ROLES.has(membership.role)) {
    return jsonError('Only an owner or admin can change the plan', 403)
  }

  // The price comes from the database, never from the request. A client-supplied
  // price id would let anyone subscribe the organization to a $0 price they
  // created in their own Stripe account — or to another customer's.
  const plan = await prisma.plan.findUnique({ where: { code: planCode } })
  if (!plan || !plan.isPublic) {
    return jsonError('Unknown plan', 400)
  }
  if (!plan.stripePriceId) {
    logger.error({ planCode }, 'Plan has no Stripe price configured')
    return jsonError('This plan cannot be purchased yet', 503)
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, stripeCustomerId: true },
  })
  if (!organization) return jsonError('Not found', 404)

  // Absolute, and operator-configured. Deriving the return origin from the
  // request `Host` would let anyone who controls that header choose where a
  // paying customer lands after checkout — the same call already made for
  // emailed links.
  const appBaseUrl = requireAppBaseUrl()

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      // Reuses the existing customer when there is one, so a returning
      // subscriber keeps one invoice history rather than accumulating records.
      // `customer_creation` is deliberately not set for a first-time subscriber:
      // that param is only valid in `mode: 'payment'` — Stripe rejects it with a
      // 400 in `mode: 'subscription'`, which creates a customer automatically
      // whenever none is passed.
      ...(organization.stripeCustomerId ? { customer: organization.stripeCustomerId } : {}),
      // Both carried: `client_reference_id` survives on the session, and
      // `metadata` is what the webhook copies onto the subscription so every
      // later lifecycle event knows which organization it belongs to.
      client_reference_id: organizationId,
      metadata: { organizationId },
      subscription_data: { metadata: { organizationId } },
      success_url: `${appBaseUrl}/billing?checkout=success`,
      cancel_url: `${appBaseUrl}/billing?checkout=cancelled`,
    })

    if (!session.url) {
      logger.error({ organizationId, sessionId: session.id }, 'Stripe returned no checkout URL')
      return jsonError('Could not start checkout', 502)
    }

    logger.info({ organizationId, planCode, sessionId: session.id }, 'Checkout session created')
    return jsonSuccess({ url: session.url })
  } catch (error) {
    logger.error({ error, organizationId, planCode }, 'Failed to create Stripe checkout session')
    return jsonError('Could not start checkout', 502)
  }
})
