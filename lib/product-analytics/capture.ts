import logger from '@/lib/logger'

/**
 * The event taxonomy (issue #152), as a closed map rather than bare strings
 * at each call site. A typo'd event name is then a compile error instead of
 * a silently un-fired analytics event nobody notices until the funnel is
 * missing data.
 *
 * Lives here, in the Community tree, rather than in `ee/product-analytics/`
 * where the rest of the implementation does: eight non-commercial route
 * handlers and `lib/mcp/tools.ts` reference these names, and
 * `scripts/foss.mjs` deletes `ee/` wholesale for the FOSS build — a static
 * import of an `ee/` module from any of those files breaks that build at
 * compile time, not just at runtime. `ee/product-analytics/capture.ts`
 * re-exports this same map for its own (EE-internal) callers.
 *
 * Names and fire points, from the issue's phasing:
 *   - inbox_created           app/api/app/emailInbox/route.ts POST
 *   - second_inbox_created    same path, when the org's live count reaches 2
 *   - message_viewed          the isRead PATCH branch, messages/[messageId]
 *   - automation_created      app/api/app/automations/route.ts POST
 *   - plan_limit_denied       every jsonPlanDenial / checkResourceLimit 402
 *   - checkout_completed      Stripe webhook creating a Subscription row
 *   - api_key_created         app/api/app/apiKeys/route.ts POST
 *   - webhook_created         app/api/app/webhooks/route.ts POST
 *   - message_search_used     a non-null MessageSearch on a messages GET
 *   - mcp_tool_called         every MCP tool invocation, app/api/mcp
 */
export const PRODUCT_ANALYTICS_EVENTS = {
  inboxCreated: 'inbox_created',
  secondInboxCreated: 'second_inbox_created',
  messageViewed: 'message_viewed',
  automationCreated: 'automation_created',
  planLimitDenied: 'plan_limit_denied',
  checkoutCompleted: 'checkout_completed',
  apiKeyCreated: 'api_key_created',
  webhookCreated: 'webhook_created',
  messageSearchUsed: 'message_search_used',
  mcpToolCalled: 'mcp_tool_called',
} as const

export type ProductAnalyticsEvent =
  (typeof PRODUCT_ANALYTICS_EVENTS)[keyof typeof PRODUCT_ANALYTICS_EVENTS]

export type ProductAnalyticsCaptureFn = (
  event: ProductAnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
) => void

/**
 * `globalThis`-backed, not module scope — the same reason
 * `ee/product-analytics/client.ts`'s PostHog client is: Next's bundler
 * (webpack in prod, Turbopack in dev) can compile a source file into
 * multiple independent module instances across chunks, so a module-scope
 * variable set by the copy `ee/product-analytics/init.ts` imports (from
 * `instrumentation.ts`, at boot) would not necessarily be visible from the
 * copy a route handler's chunk imports. That is the exact defect class that
 * hit `CommercialProvider` in `lib/commercial/provider.ts` before it moved
 * to `globalThis` — see the note on `lib/db.ts`'s Prisma singleton.
 */
const globalForCapture = globalThis as unknown as {
  __inboxuiProductAnalyticsCapture?: ProductAnalyticsCaptureFn
}

/**
 * Registers the real (EE) implementation. Called exactly once, at boot, from
 * `ee/product-analytics/init.ts` — which only exists to be called on a build
 * that still has `ee/` in it. The FOSS entrypoint (`instrumentation.foss.ts`)
 * never imports that file at all, so nothing ever calls this on a FOSS
 * build, and `captureEvent` below stays the no-op it already is by default.
 */
export function registerProductAnalyticsCapture(fn: ProductAnalyticsCaptureFn): void {
  globalForCapture.__inboxuiProductAnalyticsCapture = fn
}

/** Test-only: undo `registerProductAnalyticsCapture`. */
export function resetProductAnalyticsCapture(): void {
  globalForCapture.__inboxuiProductAnalyticsCapture = undefined
}

/**
 * Fires a named server-side event (issue #152).
 *
 * The one module every non-commercial route handler and service-layer call
 * imports for this — never `@/ee/product-analytics/capture` directly, which
 * `scripts/foss.mjs` deletes for the FOSS build and would break every one of
 * those call sites at compile time.
 *
 * No-op — no `posthog-node` import anywhere in this module, no network
 * activity — whenever nothing is registered, which is true by construction
 * on a FOSS build and true at runtime on an EE build with
 * `ENABLE_PRODUCT_ANALYTICS` off, since the registered implementation itself
 * checks that flag on every call.
 *
 * Best-effort and never throws, independent of whatever guarantee the
 * registered implementation makes about itself — a caller here has no way to
 * know which build it is running in, so it cannot rely on that.
 */
export function captureEvent(
  event: ProductAnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  const impl = globalForCapture.__inboxuiProductAnalyticsCapture
  if (!impl) return

  try {
    impl(event, distinctId, properties)
  } catch (error) {
    logger.warn({ error, event }, '[product-analytics] capture delegate threw')
  }
}
