import type { IPlanResolver, ResolvedPlan } from '../interfaces'
import { SELF_HOSTED_PLAN_CODE } from '../interfaces'
import { UNLIMITED } from '../plan-limits'

/**
 * OSS default: every organization is on the unlimited `self_hosted` plan.
 *
 * Critically, this **never queries the database**. With `USE_COMMERCIAL=false`
 * the `plans`, `subscriptions` and `usage_counters` tables exist (they are in
 * the single shared schema) but are never read, so a self-hosted deployment
 * pays nothing for a feature it does not use — no join on the inbound email
 * path, no seed migration to keep current, no cache to invalidate.
 */
export class UnlimitedPlanResolver implements IPlanResolver {
  private static readonly PLAN: ResolvedPlan = Object.freeze({
    planCode: SELF_HOSTED_PLAN_CODE,
    planName: 'Self-hosted',
    limits: UNLIMITED,
    periodStart: null,
    periodEnd: null,
  })

  async resolve(_organizationId: string): Promise<ResolvedPlan> {
    return UnlimitedPlanResolver.PLAN
  }
}
