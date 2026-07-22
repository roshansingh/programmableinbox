import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError, isUniqueViolation } from '@/lib/api-helpers'
import { parseInboxAddress } from '@/lib/email-address'
import logger from '@/lib/logger'

/**
 * Deliberately identical whether the address is held by another tenant or by a
 * soft-deleted inbox, so this endpoint cannot be used to probe which addresses
 * exist in other orgs.
 */
const ADDRESS_UNAVAILABLE = 'Email address is not available'

export async function GET(request: NextRequest) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const organizationId = request.nextUrl.searchParams.get('organizationId')

  if (context.kind === 'user') {
    const where: { userId: string; organizationId?: string } = { userId: context.userId }
    if (organizationId) {
      const membership = context.memberships.find((m) => m.organizationId === organizationId)
      if (!membership) {
        return jsonError('Not a member of this organization', 403)
      }
      where.organizationId = organizationId
    }

    const inboxes = await prisma.emailInbox.findMany({ where })
    return jsonSuccess(inboxes)
  }

  // API key auth
  const scopeResult = requireScope(context, 'inboxes:read')
  if ('error' in scopeResult) {
    return scopeResult.error
  }

  if (organizationId) {
    const orgResult = requireOrgAccess(context, organizationId)
    if ('error' in orgResult) {
      return orgResult.error
    }
  }

  const where: { organizationId: string } = { organizationId: organizationId || context.organizationId }
  const inboxes = await prisma.emailInbox.findMany({ where })

  return jsonSuccess(inboxes)
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  try {
    const { organizationId, email, name } = await request.json()

    if (!organizationId || !email) {
      return jsonError('organizationId and email are required', 400)
    }

    const membership = user.memberships.find((m) => m.organizationId === organizationId)
    if (!membership) {
      return jsonError('Not a member of this organization', 403)
    }

    // Normalize before anything compares or stores the address (F1). Inbound
    // routing matches on the lowercased recipient, so claiming must happen in
    // that same space — otherwise `Billing@corp.com` and `billing@corp.com`
    // are two rows to the unique index but one address to the router, and the
    // second claimant intercepts the first's mail.
    const address = parseInboxAddress(email)
    if (!address) {
      return jsonError('email must be a valid email address', 400)
    }

    // Friendly pre-check. Not authoritative: reads are soft-delete filtered, so
    // an address held by a deleted inbox is invisible here, and two concurrent
    // requests can both pass. The unique index below is what decides.
    const existing = await prisma.emailInbox.findFirst({
      where: { email: address },
      select: { id: true },
    })
    if (existing) {
      return jsonError(ADDRESS_UNAVAILABLE, 409)
    }

    const inbox = await prisma.emailInbox.create({
      data: {
        organizationId,
        userId: user.id,
        email: address,
        name: name || null,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch (error) {
    // Race-safe backstop: inbox addresses are globally unique (F1), so a
    // claimed address is a client error, not a server fault. Reached when the
    // pre-check couldn't see the holder — a soft-deleted inbox, or a request
    // that committed in between.
    if (isUniqueViolation(error, 'email')) {
      return jsonError(ADDRESS_UNAVAILABLE, 409)
    }
    logger.error({ error }, 'Failed to create email inbox')
    return jsonError('Internal server error', 500)
  }
}
