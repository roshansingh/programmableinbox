import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toOwnerScope, toMessageReadScope } from '@/lib/services/scope'
import { getMessage, setMessageStarred, setMessageRead, deleteMessage } from '@/lib/services/email-inbox'
import { serializeAppMessage } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { captureEvent, PRODUCT_ANALYTICS_EVENTS } from '@/ee/product-analytics/capture'
import logger from '@/lib/logger'

type Params = { id: string; messageId: string }

export const GET = withUser<Params>(async (_request, principal, { params }) => {
  const { id: inboxId, messageId } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const message = await getMessage(scope, inboxId, messageId)
  if (!message) return jsonError('Message not found', 404)

  return jsonSuccess(serializeAppMessage(message))
})

export const PATCH = withUser<Params>(async (request, principal, { params }) => {
  const { id: inboxId, messageId } = await params

  try {
    const body = await request.json()

    // Rejected rather than silently honoring one and dropping the other —
    // the isStarred branch below returns before the isRead branch would run,
    // so a request naming both would otherwise apply isStarred only with no
    // signal to the caller that isRead was ignored.
    if ('isStarred' in body && 'isRead' in body) {
      return jsonError('Provide only one of isStarred or isRead per request', 400)
    }

    if ('isStarred' in body) {
      const { isStarred } = body
      if (typeof isStarred !== 'boolean') {
        return jsonError('isStarred must be a boolean', 400)
      }

      // Creator-only: reads widened to the organization, mutation authority did not.
      const updated = await setMessageStarred(toOwnerScope(principal), inboxId, messageId, isStarred)
      if (!updated) return jsonError('Message not found', 404)

      return jsonSuccess(serializeAppMessage(updated))
    }

    if ('isRead' in body) {
      const { isRead } = body
      if (typeof isRead !== 'boolean') {
        return jsonError('isRead must be a boolean', 400)
      }

      // Org-wide, unlike isStarred: any teammate viewing a shared inbox can
      // progress its read state (issue #138), not just its creator.
      const { scope, error } = toMessageReadScope(principal)
      if (error) return error

      const updated = await setMessageRead(scope, inboxId, messageId, isRead)
      if (!updated) return jsonError('Message not found', 404)

      // Only the true transition counts as "viewed" (issue #152) — flipping
      // back to unread is a deliberate un-read action, not a second view.
      if (isRead && config.productAnalytics.enabled) {
        captureEvent(PRODUCT_ANALYTICS_EVENTS.messageViewed, principal.userId, {
          inboxId,
          messageId,
        })
      }

      return jsonSuccess(serializeAppMessage(updated))
    }

    return jsonError('isStarred or isRead must be provided', 400)
  } catch (error) {
    logger.error({ error, inboxId, messageId }, 'Failed to update message')
    return jsonError('Internal server error', 500)
  }
})

export const DELETE = withUser<Params>(async (_request, principal, { params }) => {
  const { id: inboxId, messageId } = await params

  const deleted = await deleteMessage(toOwnerScope(principal), inboxId, messageId)
  if (!deleted) return jsonError('Message not found', 404)

  return new Response(null, { status: 204 })
})
