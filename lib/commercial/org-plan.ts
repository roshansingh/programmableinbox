import 'server-only'
import { config } from '@/lib/config'
import { CommercialProvider } from './provider'
import type { PlanLimits } from './plan-limits'

/**
 * A plan as the browser sees it (issue #117 §7b).
 *
 * `code` for any client-side branching, `name` for display, `limits` so the UI
 * can render "1 of 1 inboxes used" without a second round-trip. Deliberately
 * **not** the numeric `Plan.id`, which is a surrogate whose value is assigned
 * by a sequence and is not contractual.
 *
 * Live usage is not here — it belongs to `GET /api/app/usage`. `/auth/me` is
 * fetched once on mount, so a counter embedded in it would be stale the moment
 * it was cached.
 */
export type OrganizationPlan = {
  code: string
  name: string
  limits: PlanLimits
}

/**
 * Resolves plans for the organizations a user belongs to.
 *
 * Rides `organizations[]` rather than `AppConfig`: a plan is tenant-scoped, and
 * `AppConfig` is deployment-scoped — every field in it is identical for every
 * user of the install. Attaching a plan there would have no correct value for a
 * user in two organizations on different plans, and `role` already sets the
 * precedent for per-organization attributes living on the organization object.
 *
 * Returns an empty map when `USE_COMMERCIAL` is off, so a self-hosted
 * deployment pays no per-membership lookup on every dashboard mount for a value
 * that is always unlimited. The client reads the absence as "no plan
 * restrictions", which is exactly right there.
 */
export async function resolveOrganizationPlans(
  organizationIds: string[],
): Promise<Map<string, OrganizationPlan>> {
  const plans = new Map<string, OrganizationPlan>()
  if (!config.commercial.enabled) return plans

  await Promise.all(
    organizationIds.map(async (organizationId) => {
      const plan = await CommercialProvider.plans.resolve(organizationId)
      plans.set(organizationId, {
        code: plan.planCode,
        name: plan.planName,
        limits: plan.limits,
      })
    }),
  )

  return plans
}
