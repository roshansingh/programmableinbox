import { prisma } from '@/lib/db'
import type { IPlanResolver, ResolvedPlan } from '@/lib/commercial/interfaces'
import { PlanLimitsSchema } from '@/lib/commercial/plan-limits'
import { periodFor } from './period'
import { isEntitled } from '@/ee/billing/subscription-sync'

/** The plan an organization with no subscription row falls back to. */
const DEFAULT_PLAN_CODE = 'free'

/**
 * Resolves an organization's plan from `subscriptions` joined to `plans`
 * (issue #117 §5).
 *
 * Only ever installed when `USE_COMMERCIAL=true` — `ee/init.ts` does not call
 * `CommercialProvider.configure()` otherwise, so a self-hosted deployment keeps
 * the OSS `UnlimitedPlanResolver` and never reads these tables at all.
 *
 * **Not cached yet.** The issue specifies a Redis cache with a DB fallback, and
 * that is still worth doing — but the only Redis client lifecycle in this repo
 * lives inside `lib/security/rate-limit.ts`, and CLAUDE.md already records that
 * it and `lib/automations/replay-rate-limit.ts` ought to be unified. Opening a
 * third independent client here would treble that debt to save a single indexed
 * lookup on a unique key. Caching belongs in the same change that unifies them.
 */
export class DbPlanResolver implements IPlanResolver {
  async resolve(organizationId: string): Promise<ResolvedPlan> {
    const now = new Date()

    const row = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    })

    // Entitlement follows the *status*, not merely the existence of a row.
    //
    // `past_due` is deliberately entitled: Stripe retries a failed card on its
    // own schedule for roughly three weeks, and dropping a customer to `free`
    // on the first decline would stop their mail over an expired card — which
    // on a `drop` plan destroys it. Entitlement ends when Stripe gives up and
    // the webhook deletes the row.
    //
    // A `canceled` row should never exist, because the webhook deletes rather
    // than storing that status. Checking anyway means a row left behind by a
    // missed event cannot keep serving paid limits to someone who stopped
    // paying — the failure direction that costs money.
    const subscription = row && isEntitled(row.status) ? row : null
    const planRow = subscription?.plan ?? (await this.defaultPlan())

    return {
      planCode: planRow.code,
      planName: planRow.name,
      // Parsed, not passed through: rows are stored sparsely (only what the
      // plan restricts), so the schema's defaults are what make every limit
      // present. Malformed values throw here rather than silently degrading —
      // a plan that stops enforcing its own cap must be loud.
      limits: PlanLimitsSchema.parse(planRow.limits),
      ...periodFor(subscription, now),
    }
  }

  /**
   * A deployment running with `USE_COMMERCIAL=true` and no seeded plans is
   * misconfigured. Returning unlimited limits here would hand every
   * organization an unmetered account while looking like success, so this
   * throws instead — the same posture as `assertConfig()` refusing to boot on a
   * missing `REDIS_URL` rather than quietly disabling the limiter.
   */
  private async defaultPlan() {
    const plan = await prisma.plan.findUnique({ where: { code: DEFAULT_PLAN_CODE } })
    if (!plan) {
      throw new Error(
        `Plan '${DEFAULT_PLAN_CODE}' is not seeded. USE_COMMERCIAL is on but the plans table has ` +
          `no default plan, so no organization can be resolved. Run the migrations.`,
      )
    }
    return plan
  }
}
