import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { listInboxes } from '@/lib/services/email-inbox'
import { serializeAppInbox } from '@/lib/serializers/app/email-inbox'
import { prisma } from '@/lib/db'
import { parseInboxAddress } from '@/lib/email-address'
import { jsonSuccess, jsonError, isUniqueViolation } from '@/lib/api-helpers'
import logger from '@/lib/logger'

/**
 * Deliberately identical whether the address is held by another tenant or by a
 * soft-deleted inbox, so this endpoint cannot be used to probe which addresses
 * exist in other orgs.
 */
const ADDRESS_UNAVAILABLE = 'Email address is not available'

export const GET = withUser(async (request, principal) => {
  const requested = request.nextUrl.searchParams.get('organizationId')

  const { scope, error } = toOrgScope(principal, requested)
  if (error) return error

  const inboxes = await listInboxes(scope)
  return jsonSuccess(inboxes.map((inbox) => serializeAppInbox(inbox, principal.userId)))
})

export const POST = withUser(async (request, principal) => {
  try {
    const { organizationId, email, name } = await request.json()

    if (!organizationId || !email) {
      return jsonError('organizationId and email are required', 400)
    }

    const { error } = toOrgScope(principal, organizationId)
    if (error) return error

    // Normalize before anything compares or stores the address (F1). Inbound
    // routing matches on the lowercased recipient, so claiming must happen in
    // that same space — otherwise `Billing@corp.com` and `billing@corp.com`
    // are two rows to the unique index but one address to the router, and the
    // second claimant intercepts the first's mail.
    const address = parseInboxAddress(email)
    if (!address) return jsonError('email must be a valid email address', 400)

    // Friendly pre-check. Not authoritative: reads are soft-delete filtered, so
    // an address held by a deleted inbox is invisible here, and two concurrent
    // requests can both pass. The unique index below is what decides.
    const existing = await prisma.emailInbox.findFirst({
      where: { email: address },
      select: { id: true },
    })
    if (existing) return jsonError(ADDRESS_UNAVAILABLE, 409)

    const inbox = await prisma.emailInbox.create({
      data: { organizationId, userId: principal.userId, email: address, name: name || null },
    })

    return jsonSuccess(serializeAppInbox(inbox, principal.userId), 201)
  } catch (error) {
    if (isUniqueViolation(error, 'email')) return jsonError(ADDRESS_UNAVAILABLE, 409)
    logger.error({ error }, 'Failed to create email inbox')
    return jsonError('Internal server error', 500)
  }
})
