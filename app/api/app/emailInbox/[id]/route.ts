import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toOwnerScope } from '@/lib/services/scope'
import { getInbox, getOwnedInbox, updateInbox, deleteInbox } from '@/lib/services/email-inbox'
import { serializeAppInbox } from '@/lib/serializers/app/email-inbox'
import { parseInboxAddress } from '@/lib/email-address'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

const EMAIL_IMMUTABLE =
  'The address of an inbox cannot be changed. Create a new inbox instead.'

export const GET = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const inbox = await getInbox(scope, id)
  if (!inbox) return jsonError('Not found', 404)

  return jsonSuccess(serializeAppInbox(inbox, principal.userId))
})

export const PATCH = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  try {
    const { email, name } = await request.json()

    // Owner-scoped, and resolved before any body field is inspected. Using the
    // read scope here would answer a body-shaped question for a caller with no
    // authority to mutate: a non-owner in the same organization would get the
    // 409 below instead of 404, which tells them the inbox exists and that
    // their address guess was wrong.
    const existing = await getOwnedInbox(toOwnerScope(principal), id)
    if (!existing) return jsonError('Not found', 404)

    // The address is immutable once the inbox exists (F1). Re-pointing it was a
    // second route to cross-tenant interception — claim a throwaway address,
    // then move it onto a case variant of a tenant's — and it also breaks the
    // guarantee that a delivered message's recipient still names a live inbox.
    //
    // A submission that matches the current address (after normalization) is a
    // no-op and allowed, so a client can PATCH the full record to rename it.
    if (email !== undefined && parseInboxAddress(email) !== existing.email) {
      return jsonError(EMAIL_IMMUTABLE, 409)
    }

    const updated = await updateInbox(toOwnerScope(principal), id, { name })
    if (!updated) return jsonError('Not found', 404)

    return jsonSuccess(serializeAppInbox(updated, principal.userId))
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
  const deleted = await deleteInbox(toOwnerScope(principal), id)
  if (!deleted) return jsonError('Not found', 404)

  return new Response(null, { status: 204 })
})
