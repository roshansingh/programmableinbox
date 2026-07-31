import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const PATCH = withUser(async (request, principal) => {

  const body = await request.json()
  const { organizationId, name } = body

  if (!organizationId || typeof organizationId !== 'string') {
    return jsonError('organizationId is required', 400)
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return jsonError('name is required', 400)
  }


  // Membership now resolves through the one place that owns that decision.
  // Note this changes the body from 'Forbidden' to toOrgScope's message; the
  // status is unchanged and no client reads the string.
  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { name: name.trim() },
  })

  return jsonSuccess(org)
})
