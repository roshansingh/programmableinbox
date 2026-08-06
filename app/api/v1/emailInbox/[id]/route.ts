import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope, toInboxWriteScope, toInboxDeleteScope } from '@/lib/services/scope'
import { getInbox, updateInboxForWrite, deleteInbox } from '@/lib/services/email-inbox'
import { serializePublicInbox } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

/**
 * GET, PATCH and DELETE, on three separate scopes.
 *
 * The scopes are granular rather than one `email_inboxes:write` because they
 * do not cost the same to get wrong. A rename is recoverable. A delete
 * soft-deletes the row — recoverable — but retires the address permanently,
 * because `EmailInbox.email` is a plain unique index rather than one partial
 * on `deletedAt IS NULL`: DNS keeps delivering after deletion, so freeing the
 * address would hand the next claimant the previous owner's mail.
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
  { scopes: ['email_inboxes:update'] },
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

/**
 * Soft-deletes the inbox and its messages in one transaction.
 *
 * The response is 204 with no body, matching the dashboard route. There is
 * nothing meaningful to return: the row still exists but every read filters it
 * out, so echoing it back would show the caller a record they can no longer
 * fetch.
 *
 * A 404 covers both "no such inbox" and "not one this key may delete",
 * deliberately indistinguishable — the same rule the read paths follow.
 */
export const DELETE = withApiKey<{ id: string }>(
  { scopes: ['email_inboxes:delete'] },
  async (_request, principal, { params }) => {
    const { id } = await params

    try {
      const { scope, error } = toInboxDeleteScope(principal)
      if (error) return error

      const deleted = await deleteInbox(scope, id)
      if (!deleted) return jsonError('Not found', 404)

      return new Response(null, { status: 204 })
    } catch (error) {
      logger.error({ error, inboxId: id }, 'Failed to delete email inbox via the external API')
      return jsonError('Internal server error', 500)
    }
  },
)
