import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toOwnerScope } from '@/lib/services/scope'
import { getMessage, setMessageStarred, deleteMessage } from '@/lib/services/email-inbox'
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
    const { isStarred } = await request.json()

    if (typeof isStarred !== 'boolean') {
      return jsonError('isStarred must be a boolean', 400)
    }

    // Creator-only: reads widened to the organization, mutation authority did not.
    const updated = await setMessageStarred(toOwnerScope(principal), inboxId, messageId, isStarred)
    if (!updated) return jsonError('Message not found', 404)

    return jsonSuccess(serializeAppMessage(updated))
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
