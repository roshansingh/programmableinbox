import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { getPostHogClient } from './client'

/**
 * Installs server-side product analytics (EE, issue #152).
 *
 * Structurally identical to `ee/observability/init.ts`: a single
 * `initializeProductAnalytics()`, no-op unless
 * `config.productAnalytics.enabled`, called once at process start from the
 * root `instrumentation.ts` alongside `initializeObservability()` — both
 * before `initializeCommercialPlans()`, per the existing ordering there.
 *
 * A no-op unless the flag is on, which is what makes deleting `ee/` (the
 * Community build) behave identically to leaving it off:
 * `getPostHogClient()` is never called, so no `posthog-node` client — and no
 * network activity — exists in that process at all.
 *
 * Constructing the client eagerly here, rather than lazily on the first
 * `captureEvent()` call, matches `initializeObservability()`'s eager
 * `registerOTel()` and gives a single boot-time signal ("product analytics
 * enabled") rather than a silent first-request cost.
 */
export function initializeProductAnalytics(): void {
  if (!config.productAnalytics.enabled) {
    return
  }

  getPostHogClient()

  logger.info('[product-analytics] PostHog capture enabled')
}
