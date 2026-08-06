import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope, toInboxWriteScope } from '@/lib/services/scope'
import { getInbox, updateInboxForWrite } from '@/lib/services/email-inbox'
import { serializePublicInbox } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

/**
 * GET and PATCH. DELETE stays on /api/app/emailInbox/[id]: deleting an inbox
 * soft-deletes it and its messages and permanently retires the address, which
 * is irreversible in a way renaming is not. It remains creator-only and
 * key-unreachable by type — `deleteInbox` takes an `OwnerScope`, which only a
 * `UserPrincipal` can produce.
 */
export const GET = withApiKey<{ id: string }>(
  { scopes: ['email_inboxes:read'] },
  async (_request, principal, { params }) => {
    const { id } = await params

    const { scope, error } = toOrgScope(principal)
    if (error) return error

    const inbox = await getInbox(scope, id)
    if (!inbox) return jsonError('Not found', 404)

    return jsonSuccess(serializePublicInbox(inbox))
  },
)

/**
 * Renames an inbox. The address is immutable and the name policy is the issue
 * #98 one — both enforced inside `updateInboxForWrite`, shared with the
 * dashboard's PATCH, so the blocklist cannot be enforced in one place and not
 * the other.
 */
export const PATCH = withApiKey<{ id: string }>(
  { scopes: ['email_inboxes:write'] },
  async (request, principal, { params }) => {
    const { id } = await params

    let body: { email?: unknown; name?: unknown }

    try {
      body = await request.json()
    } catch {
      return jsonError('Request body must be valid JSON', 400)
    }

    try {
      // A key always resolves to its own organization, so this cannot be
      // narrowed or redirected by anything in the request.
      const { scope, error } = toInboxWriteScope(principal)
      if (error) return error

      const result = await updateInboxForWrite(scope, id, {
        email: body.email,
        name: body.name,
      })
      if (result.error) return jsonError(result.error.message, result.error.status)

      return jsonSuccess(serializePublicInbox(result.inbox))
    } catch (error) {
      logger.error({ error, inboxId: id }, 'Failed to update email inbox via the external API')
      return jsonError('Internal server error', 500)
    }
  },
)
