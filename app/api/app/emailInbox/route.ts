import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope, toInboxWriteScope } from '@/lib/services/scope'
import { createInbox, listInboxes } from '@/lib/services/email-inbox'
import { serializeAppInbox } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
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
    if (result.error) return jsonError(result.error.message, result.error.status)

    return jsonSuccess(serializeAppInbox(result.inbox, principal.userId), 201)
  } catch (error) {
    logger.error({ error }, 'Failed to create email inbox')
    return jsonError('Internal server error', 500)
  }
})
