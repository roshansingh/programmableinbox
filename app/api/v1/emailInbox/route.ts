import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

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

    const inbox = await prisma.emailInbox.create({
      data: {
        organizationId,
        userId: user.id,
        email,
        name: name || null,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
}
