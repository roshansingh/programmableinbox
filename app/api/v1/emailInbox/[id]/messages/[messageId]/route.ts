import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { getMessage } from '@/lib/services/email-inbox'
import { serializePublicMessage } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

/**
 * GET only. The PATCH (star) and DELETE handlers that used to live here moved
 * to /api/app/emailInbox — star is dashboard UI state that never belonged in a
 * public contract, and the delete was reachable by any organization key.
 *
 * The PATCH was also gated by `messages:read`, so a key issued as read-only
 * could mutate. That scope string is now declared in the withApiKey call
 * beside the method rather than inside the handler body, where it drifted.
 */
export const GET = withApiKey<{ id: string; messageId: string }>(
  { scopes: ['messages:read'] },
  async (_request, principal, { params }) => {
    const { id: inboxId, messageId } = await params

    const { scope, error } = toOrgScope(principal)
    if (error) return error

    const message = await getMessage(scope, inboxId, messageId)
    if (!message) return jsonError('Message not found', 404)

    return jsonSuccess(serializePublicMessage(message))
  },
)
