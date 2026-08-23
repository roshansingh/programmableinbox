import 'server-only'
import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { getPostHogClient } from './client'
import {
  PRODUCT_ANALYTICS_EVENTS,
  type ProductAnalyticsEvent,
} from '@/lib/product-analytics/capture'

/**
 * The event taxonomy now lives in `@/lib/product-analytics/capture` — the
 * Community tree, not here — because eight non-commercial route handlers
 * and `lib/mcp/tools.ts` reference these names, and `scripts/foss.mjs`
 * deletes this whole directory for the FOSS build. Re-exported here so this
 * module's own (EE-internal) callers — `ee/billing/subscription-sync.ts` and
 * this file's own test — don't need to know that.
 */
export { PRODUCT_ANALYTICS_EVENTS, type ProductAnalyticsEvent }

/**
 * Fires a named server-side event (issue #152). The real, PostHog-talking
 * implementation — registered into `@/lib/product-analytics/capture`'s
 * facade by `./init.ts` at boot, which is what non-commercial call sites
 * actually import. Nothing outside `ee/` imports this file directly.
 *
 * A no-op — no PostHog client constructed, no network call — whenever
 * `ENABLE_PRODUCT_ANALYTICS` is off, which is the default and must stay free
 * of any observable side effect in that state.
 *
 * Best-effort and never throws. This is telemetry, not part of the request's
 * correctness — a PostHog outage or a malformed property must not turn a
 * successful mutation into a 500, on the same reasoning as "a verification
 * email send failure never fails the signup" elsewhere in this codebase.
 * `posthog-node` itself queues and flushes asynchronously on its own
 * schedule, so this call does not block the response either.
 */
export function captureEvent(
  event: ProductAnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (!config.productAnalytics.enabled) return

  try {
    getPostHogClient().capture({ distinctId, event, properties })
  } catch (error) {
    logger.warn({ error, event }, '[product-analytics] failed to capture event')
  }
}
