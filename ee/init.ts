import { config } from '@/lib/config'
import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { DbPlanResolver, DEFAULT_PLAN_CODE } from './plans/resolver'
import { PostgresQuota } from './plans/quota'
import { NoopMetering } from '@/lib/commercial/oss/NoopMetering'
import logger from '@/lib/logger'

/**
 * Installs the commercial plan engine (issue #117 §8).
 *
 * Called once at process start from the root `instrumentation.ts`. When
 * `USE_COMMERCIAL` is off this returns without configuring anything, so the OSS
 * defaults stay in place and the `plans`, `subscriptions` and `usage_counters`
 * tables are never read — that short-circuit lives here rather than inside
 * `DbPlanResolver`, so a self-hosted deployment never even constructs it.
 *
 * Deleting `ee/` removes the only caller of `CommercialProvider.configure()`,
 * which is what makes the stripped build unlimited by construction rather than
 * by a flag someone has to remember to set.
 *
 * Metering is still the OSS no-op: billing telemetry has no consumer until
 * Stripe lands, and `IMetering` is explicitly allowed to drop writes, so it is
 * not — and must not become — the thing enforcement reads.
 */
export function initializeCommercialPlans(): void {
  if (!config.commercial.enabled) {
    logger.info('[commercial] USE_COMMERCIAL is off — plans unlimited, plan tables unread')
    return
  }

  const plans = new DbPlanResolver()
  CommercialProvider.configure(plans, new PostgresQuota(plans), new NoopMetering())

  logger.info('[commercial] plan enforcement enabled')

  // Fire-and-forget, deliberately. Enforcement is already wired by this point,
  // so a diagnostic must neither delay boot nor be able to fail it — a database
  // that is not accepting connections yet is an ordinary startup race.
  void warnOnUnpurchasablePlans()
}

/**
 * Warns when a plan a customer could try to buy has no Stripe price.
 *
 * `Plan.stripePriceId` is set by hand (`UPDATE plans SET "stripePriceId" = …`)
 * rather than seeded, because a price id is per-deployment operational data:
 * test-mode and live-mode ids differ, and a value baked into a migration would
 * be wrong in most environments and meaningless to every fork.
 *
 * The cost of that is a step someone can forget, and the symptom is a 503 from
 * `POST /api/app/billing/checkout` — discovered when a customer tries to pay.
 * This moves the discovery to deploy time.
 *
 * A warning rather than an `assertConfig()` failure: a deployment part-way
 * through setup is legitimately in this state, and refusing to boot would make
 * the setup order Stripe-first rather than deploy-first.
 */
async function warnOnUnpurchasablePlans(): Promise<void> {
  try {
    const unpriced = await prisma.plan.findMany({
      where: {
        isPublic: true,
        stripePriceId: null,
        // The default plan is public and unpriced by design — nobody checks
        // out for the plan they fall back to. Warning about it every boot is
        // how a warning stops being read.
        code: { not: DEFAULT_PLAN_CODE },
      },
      select: { code: true, name: true },
    })

    if (unpriced.length === 0) return

    logger.warn(
      { planCodes: unpriced.map((plan) => plan.code) },
      'Plans are advertised but cannot be purchased: no stripePriceId is set, so ' +
        'checkout will return 503. Set one with: ' +
        `UPDATE plans SET "stripePriceId" = 'price_...' WHERE code = '${unpriced[0].code}';`,
    )
  } catch (error) {
    logger.warn({ error }, '[commercial] could not check plan prices at boot')
  }
}
