import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toOwnerScope, toMessageReadScope } from '@/lib/services/scope'
import { getMessage, setMessageStarred, setMessageRead, deleteMessage } from '@/lib/services/email-inbox'
import { serializeAppMessage } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
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
