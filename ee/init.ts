import { config } from '@/lib/config'
import { CommercialProvider } from '@/lib/commercial/provider'
import { DbPlanResolver } from './plans/resolver'
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
}
