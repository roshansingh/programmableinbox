import 'server-only'
import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { getPostHogClient } from './client'

/**
 * The event taxonomy (issue #152), as a closed map rather than bare strings
 * at each call site. A typo'd event name is then a compile error instead of
 * a silently un-fired analytics event nobody notices until the funnel is
 * missing data.
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

/**
 * Fires a named server-side event (issue #152).
 *
 * The single place every route handler and service-layer call goes through,
 * so none of them has to reimplement the disabled check: a no-op — no
 * PostHog client constructed, no network call — whenever
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
