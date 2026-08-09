import { NextRequest } from 'next/server'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { CommercialProvider } from '@/lib/commercial/provider'
import type { QuotaMetric } from '@/lib/commercial/interfaces'

/**
 * Every metric the dashboard reports, including the report-only ones.
 *
 * `emails.dropped` has no limit but is the number that actually motivates an
 * upgrade on a `drop` plan — "you are at your limit" says nothing about how
 * much mail was lost.
 */
const REPORTED_METRICS: QuotaMetric[] = [
  'emails.processed',
  'emails.dropped',
  'emails.sent',
  'llm.enrichments',
  'automation.runs',
  'webhook.deliveries',
  'api.requests',
]

/**
 * Live usage for one organization (issue #117 §7c).
 *
 * Separate from `/auth/me` on purpose: that route is fetched once on mount and
 * cached in `AuthProvider`, so a counter embedded there would be stale
 * immediately. Plan *limits* change rarely and ride `/auth/me`; usage changes
 * constantly and is polled here.
 *
 * The organization is explicit rather than inferred. `toOrgScope` is the one
 * place the membership check lives, so routing through it means this endpoint
 * cannot become a second, weaker tenancy predicate.
 */
export const GET = withUser(async (request: NextRequest, principal) => {
  const requested = request.nextUrl.searchParams.get('organizationId')

  const { scope, error } = toOrgScope(principal, requested)
  if (error) return error

  // With no explicit parameter, `toOrgScope` returns every organization the
  // user belongs to. Usage is per-organization, so exactly one must be named —
  // and when there is only one membership, naming it adds nothing.
  if (scope.organizationIds.length !== 1) {
    return jsonError(
      'organizationId is required when you belong to more than one organization',
      400,
    )
  }
  const organizationId = scope.organizationIds[0]

  const plan = await CommercialProvider.plans.resolve(organizationId)

  const usage = await Promise.all(
    REPORTED_METRICS.map(async (metric) => {
      const { limit, used, resetsAt } = await CommercialProvider.quota.peek(
        organizationId,
        metric,
      )
      return { metric, limit, used, resetsAt: resetsAt?.toISOString() ?? null }
    }),
  )

  return jsonSuccess({
    organizationId,
    plan: { code: plan.planCode, name: plan.planName, limits: plan.limits },
    usage,
  })
})
