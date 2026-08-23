import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toInboxWriteScope } from '@/lib/services/scope'
import { createInbox, listInboxes } from '@/lib/services/email-inbox'
import { serializeAppInbox } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db'
import { captureEvent, PRODUCT_ANALYTICS_EVENTS } from '@/ee/product-analytics/capture'
import logger from '@/lib/logger'

export const GET = withUser(async (request, principal) => {
  const requested = request.nextUrl.searchParams.get('organizationId')

  const { scope, error } = toOrgScope(principal, requested)
  if (error) return error

  const inboxes = await listInboxes(scope)
  return jsonSuccess(inboxes.map((inbox) => serializeAppInbox(inbox, principal.userId)))
})

/**
 * Address normalization, the issue #98 policy, the probe-resistant 409 and the
 * unique-violation catch all live in `createInbox` now, so this route and
 * `POST /api/v1/emailInbox` cannot drift on any of them. What remains here is
 * the two things that genuinely differ between the surfaces: how the
 * organization is chosen, and which serializer the response uses.
 */
export const POST = withUser(async (request, principal) => {
  try {
    const { organizationId, email, name } = await request.json()

    if (!organizationId || !email) {
      return jsonError('organizationId and email are required', 400)
    }

    const { scope, error } = toInboxWriteScope(principal, organizationId)
    if (error) return error

    const result = await createInbox(scope, { email, name })
    if (result.error) {
      // `planCode` is present only on a 402 from a plan cap (see
      // InboxWriteError) — every other rejection here (malformed address,
      // blocklisted name, taken address) is the caller's mistake, not a
      // "hit a wall, needs to upgrade" moment.
      if (config.productAnalytics.enabled && result.error.planCode) {
        captureEvent(PRODUCT_ANALYTICS_EVENTS.planLimitDenied, principal.userId, {
          resource: 'emailInboxes',
          limit: result.error.limit,
          used: result.error.used,
          planCode: result.error.planCode,
        })
      }
      return jsonError(result.error.message, result.error.status)
    }

    // Gated on the flag so a disabled deployment pays no extra COUNT query
    // for the second-inbox check — captureEvent is already a no-op when
    // disabled, but the count would still run without this guard.
    if (config.productAnalytics.enabled) {
      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, principal.userId, {
        inboxId: result.inbox.id,
        organizationId,
      })

      const liveCount = await prisma.emailInbox.count({ where: { organizationId } })
      if (liveCount === 2) {
        captureEvent(PRODUCT_ANALYTICS_EVENTS.secondInboxCreated, principal.userId, {
          inboxId: result.inbox.id,
          organizationId,
        })
      }
    }

    return jsonSuccess(serializeAppInbox(result.inbox, principal.userId), 201)
  } catch (error) {
    logger.error({ error }, 'Failed to create email inbox')
    return jsonError('Internal server error', 500)
  }
})
