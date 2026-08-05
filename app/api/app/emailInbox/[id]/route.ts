import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toOwnerScope, toInboxWriteScope } from '@/lib/services/scope'
import { getInbox, updateInboxForWrite, deleteInbox } from '@/lib/services/email-inbox'
import { serializeAppInbox } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

export const GET = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const inbox = await getInbox(scope, id)
  if (!inbox) return jsonError('Not found', 404)

  return jsonSuccess(serializeAppInbox(inbox, principal.userId))
})

/**
 * The address-immutability rule (F1) and the issue #98 name policy live in
 * `updateInboxForWrite`, shared with `PATCH /api/v1/emailInbox/[id]`. Without
 * that, the blocklist would have to be enforced identically in two places, and
 * the copy that fell behind would be the one letting an inbox be renamed to
 * `Amazon Support` after the fact.
 *
 * The write scope resolves ownership before any body field is inspected, for
 * the same reason the owner scope did: answering a body-shaped question for a
 * caller with no authority to mutate would tell a non-owner in the same
 * organization that the inbox exists.
 */
export const PATCH = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  try {
    const { email, name } = await request.json()

    // No organization named, so this narrows by creator alone — exactly the
    // authority the owner scope gave before. A user cannot be denied here.
    const { scope } = toInboxWriteScope(principal)

    const result = await updateInboxForWrite(scope, id, { email, name })
    if (result.error) return jsonError(result.error.message, result.error.status)

    return jsonSuccess(serializeAppInbox(result.inbox, principal.userId))
  } catch (error) {
    logger.error({ error, inboxId: id }, 'Failed to update email inbox')
    return jsonError('Internal server error', 500)
  }
})

export const DELETE = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  // Soft delete (F8), inside deleteInbox: the inbox and its messages are
  // stamped in one transaction so neither can be served while the other is
  // hidden, and the row is kept so its address stays claimed by the unique
  // index (F1) and can never be reclaimed by another org.
  //
  // Still `OwnerScope`, and deliberately so — this is the one inbox mutation
  // an API key must never reach, which the type system enforces.
  const deleted = await deleteInbox(toOwnerScope(principal), id)
  if (!deleted) return jsonError('Not found', 404)

  return new Response(null, { status: 204 })
})
