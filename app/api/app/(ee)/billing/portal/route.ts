import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config, requireAppBaseUrl } from '@/lib/config'
import logger from '@/lib/logger'
import { getStripe } from '@/ee/billing/client'

const BILLING_ROLES = new Set(['owner', 'admin'])

/**
 * Opens Stripe's Billing Portal (issue #120 §4).
 *
 * Changing a card, downloading invoices and cancelling all happen there rather
 * than in routes here. That is the point of using Stripe: rebuilding those
 * flows means rebuilding SCA, dunning, proration and tax receipts, and getting
 * each of them subtly wrong.
 *
 * Cancellation through the portal defaults to end-of-period, which is also what
 * makes the mid-period counter question moot in practice — a downgrade takes
 * effect at the billing boundary, where the usage counter rolls over anyway.
 */
export const POST = withUser(async (request: NextRequest, principal) => {
  if (!config.commercial.enabled) {
    return jsonError('Not found', 404)
  }

  const body = await request.json().catch(() => null)
  const organizationId = (body as { organizationId?: unknown } | null)?.organizationId
  if (typeof organizationId !== 'string') {
    return jsonError('organizationId is required', 400)
  }

  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  const membership = principal.memberships.find((m) => m.organizationId === organizationId)
  if (!membership || !BILLING_ROLES.has(membership.role)) {
    return jsonError('Only an owner or admin can manage billing', 403)
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true },
  })

  // No customer record means the organization has never reached checkout, so
  // there is nothing to manage. 409 rather than 404: the organization exists,
  // its billing relationship does not.
  if (!organization?.stripeCustomerId) {
    return jsonError('This organization has no billing account yet', 409)
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${requireAppBaseUrl()}/billing`,
    })

    return jsonSuccess({ url: session.url })
  } catch (error) {
    logger.error({ error, organizationId }, 'Failed to create Stripe billing portal session')
    return jsonError('Could not open the billing portal', 502)
  }
})
