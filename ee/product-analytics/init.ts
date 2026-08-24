import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { getPostHogClient } from './client'
import { captureEvent } from './capture'
import { registerProductAnalyticsCapture } from '@/lib/product-analytics/capture'

/**
 * Installs server-side product analytics (EE, issue #152).
 *
 * Structurally identical to `ee/observability/init.ts`: a single
 * `initializeProductAnalytics()`, called once at process start from the
 * root `instrumentation.ts` alongside `initializeObservability()` — both
 * before `initializeCommercialPlans()`, per the existing ordering there.
 *
 * Registers this build's real `captureEvent` into the Community-tree facade
 * (`@/lib/product-analytics/capture`) unconditionally — every non-commercial
 * route handler imports the facade, never this module, so registration must
 * run regardless of the flag for those call sites to ever do anything on an
 * *enabled* EE build. It is still safe to register on a *disabled* one: the
 * registered `captureEvent` checks `config.productAnalytics.enabled` itself
 * on every call, so the facade delegates to a function that immediately
 * no-ops.
 *
 * Constructing the PostHog client eagerly, rather than lazily on the first
 * `captureEvent()` call, matches `initializeObservability()`'s eager
 * `registerOTel()` and gives a single boot-time signal ("product analytics
 * enabled") rather than a silent first-request cost. Still a no-op unless
 * the flag is on, which is what makes deleting `ee/` (the Community build,
 * where this function is never even called — see `instrumentation.foss.ts`)
 * behave identically to leaving it off: no `posthog-node` client, no
 * network activity, in either case.
 */
export function initializeProductAnalytics(): void {
  registerProductAnalyticsCapture(captureEvent)

  if (!config.productAnalytics.enabled) {
    return
  }

  getPostHogClient()

  logger.info('[product-analytics] PostHog capture enabled')
}
