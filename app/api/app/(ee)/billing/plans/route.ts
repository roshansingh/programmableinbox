import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { PlanLimitsSchema } from '@/lib/commercial/plan-limits'
import { getStripe } from '@/ee/billing/client'
import logger from '@/lib/logger'

type PlanPrice = { amount: number; currency: string; interval: string } | null

/**
 * Resolves the price to show for a plan (issue #120 billing page).
 *
 * `null` covers two different situations the client cannot and does not need
 * to tell apart: a plan that is genuinely free (no `stripePriceId` by design,
 * e.g. `free`) and a paid plan whose price is not configured yet (the same
 * condition `POST /api/app/billing/checkout` reports as 503). Either way,
 * there is nothing to charge and nothing to show.
 *
 * A Stripe failure degrades this one plan to a null price rather than failing
 * the whole list — a transient Stripe outage should not take down a page that
 * is otherwise just reading our own database.
 */
async function resolvePrice(stripePriceId: string | null): Promise<PlanPrice> {
  if (!stripePriceId) return null

  try {
    const price = await getStripe().prices.retrieve(stripePriceId)
    return {
      amount: price.unit_amount ?? 0,
      currency: price.currency,
      interval: price.recurring?.interval ?? 'month',
    }
  } catch (error) {
    logger.warn({ error, stripePriceId }, 'Failed to retrieve Stripe price; reporting as unavailable')
    return null
  }
}

/**
 * The plans an organization can choose between (issue #120 billing page).
 *
 * Read-only and open to any member, unlike checkout/portal: seeing what a
 * plan costs and includes is not spending anyone's money, so this does not
 * gate on `BILLING_ROLES` the way those two do.
 */
export const GET = withUser(async (_request: NextRequest) => {
  if (!config.commercial.enabled) {
    return jsonError('Not found', 404)
  }

  const rows = await prisma.plan.findMany({
    where: { isPublic: true },
    orderBy: { id: 'asc' },
  })

  const plans = await Promise.all(
    rows.map(async (row) => {
      const limits = PlanLimitsSchema.parse(row.limits)
      return {
        code: row.code,
        name: row.name,
        limits: {
          emailInboxes: limits.emailInboxes,
          incomingEmailsPerPeriod: limits.incomingEmailsPerPeriod,
          outboundEmail: limits.outboundEmail,
          llmEnrichment: limits.llmEnrichment,
        },
        price: await resolvePrice(row.stripePriceId),
      }
    }),
  )

  return jsonSuccess({ plans })
})
