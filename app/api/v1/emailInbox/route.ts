import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope, toInboxWriteScope } from '@/lib/services/scope'
import { createInbox, listInboxes } from '@/lib/services/email-inbox'
import { serializePublicInbox } from '@/lib/serializers/public/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

// No organizationId query filter here: an API key is bound to exactly one
// organization (toOrgScope resolves it from the key alone), so a filter
// parameter would either be redundant or a request to see another
// organization's inboxes — neither is a real use case for this surface.
export const GET = withApiKey({ scopes: ['email_inboxes:read'] }, async (_request, principal) => {
  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const inboxes = await listInboxes(scope)
  return jsonSuccess(inboxes.map(serializePublicInbox))
})

/**
 * The first write on the external surface.
 *
 * Everything that decides whether an address may be claimed — normalization,
 * the issue #98 domain allowlist and impersonation blocklist, the
 * probe-resistant 409, the unique-index race — lives in `createInbox`, shared
 * with `POST /api/app/emailInbox` and the MCP tool. That sharing is the point:
 * a private copy of those rules here would be a second place for the
 * anti-impersonation policy to fall out of date, and this is the surface a
 * prompt-injected agent can reach.
 *
 * There is no DELETE here. Deletion targets one inbox and lives on the `[id]`
 * route; a collection-level DELETE would be a bulk destroy of every address an
 * organization holds, and every one of those addresses is retired permanently.
 */
export const POST = withApiKey({ scopes: ['email_inboxes:create'] }, async (request, principal) => {
  let body: { email?: unknown; name?: unknown }

  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  try {
    // No organizationId to read from the body: an API key is bound to exactly
    // one organization, so there is nothing to resolve beyond it (see the GET
    // handler above for the same reasoning on the list endpoint).
    const { scope, error } = toInboxWriteScope(principal)
    if (error) return error

    const result = await createInbox(scope, { email: body.email, name: body.name })
    if (result.error) return jsonError(result.error.message, result.error.status)

    return jsonSuccess(serializePublicInbox(result.inbox), 201)
  } catch (error) {
    logger.error({ error }, 'Failed to create email inbox via the external API')
    return jsonError('Internal server error', 500)
  }
})
