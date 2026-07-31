import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { getInbox } from '@/lib/services/email-inbox'
import { serializePublicInbox } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

/**
 * GET only. PATCH and DELETE moved to /api/app/emailInbox/[id] — renaming and
 * deleting an inbox are creator-only dashboard actions, and the delete was
 * previously reachable by any key holding the organization.
 */
export const GET = withApiKey<{ id: string }>(
  { scopes: ['inboxes:read'] },
  async (_request, principal, { params }) => {
    const { id } = await params

    const { scope, error } = toOrgScope(principal)
    if (error) return error

    const inbox = await getInbox(scope, id)
    if (!inbox) return jsonError('Not found', 404)

    return jsonSuccess(serializePublicInbox(inbox))
  },
)
