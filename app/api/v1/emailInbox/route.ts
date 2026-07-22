import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError, isUniqueViolation } from '@/lib/api-helpers'
import logger from '@/lib/logger'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'

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

    const inboxes = await prisma.emailInbox.findMany({
    where,
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_UNPAGINATED_ROWS,
  })
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
  const inboxes = await prisma.emailInbox.findMany({
    where,
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_UNPAGINATED_ROWS,
  })

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

    const inbox = await prisma.emailInbox.create({
      data: {
        organizationId,
        userId: user.id,
        email,
        name: name || null,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch (error) {
    // Inbox addresses are globally unique (F1), so a claimed address is a
    // client error, not a server fault. The address may be held by another
    // org, or by a soft-deleted inbox whose address stays claimed forever —
    // both are reported the same way on purpose, so this endpoint can't be
    // used to probe which addresses exist in other tenants.
    if (isUniqueViolation(error, 'email')) {
      return jsonError('Email address is not available', 409)
    }
    logger.error({ error }, 'Failed to create email inbox')
    return jsonError('Internal server error', 500)
  }
}
