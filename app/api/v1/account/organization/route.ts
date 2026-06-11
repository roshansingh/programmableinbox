import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function PATCH(request: NextRequest) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)
  if (context.kind !== 'user') return jsonError('Forbidden', 403)

  const body = await request.json()
  const { organizationId, name } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return jsonError('name is required', 400)
  }

  const isMember = context.memberships.some((m) => m.organizationId === organizationId)
  if (!isMember) return jsonError('Forbidden', 403)

  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { name: name.trim() },
  })

  return jsonSuccess(org)
}
