import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { listInboxes } from '@/lib/services/email-inbox'
import { serializePublicInbox } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess } from '@/lib/api-helpers'

/**
 * GET only. Inbox creation moved to /api/app/emailInbox — the external surface
 * is read-only, so there is no POST here to gate.
 */
export const GET = withApiKey({ scopes: ['inboxes:read'] }, async (request, principal) => {
  const requested = request.nextUrl.searchParams.get('organizationId')

  const { scope, error } = toOrgScope(principal, requested)
  if (error) return error

  const inboxes = await listInboxes(scope)
  return jsonSuccess(inboxes.map(serializePublicInbox))
})
