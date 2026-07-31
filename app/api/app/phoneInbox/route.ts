import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'

export const GET = withUser(async (request, principal) => {
  const organizationId = request.nextUrl.searchParams.get('organizationId')

  // The requested organization used to be applied to the query unchecked. It
  // was harmless only because the userId predicate below also constrained the
  // result — a caller could narrow to an org they did not belong to and simply
  // get nothing back. Checked properly now, so the filter cannot outlive that
  // second predicate if it is ever relaxed.
  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  // Visibility itself is unchanged: phone inboxes stay creator-scoped. This
  // task fixes the missing check, it does not widen who can see what.
  const where: { userId: string; organizationId?: string } = { userId: principal.userId }
  if (organizationId) where.organizationId = organizationId

  const inboxes = await prisma.phoneInbox.findMany({
    where,
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_UNPAGINATED_ROWS,
  })

  return jsonSuccess(inboxes)
})

export const POST = withUser(async (request, principal) => {

  try {
    const { organizationId, phoneNumber, countryCode } = await request.json()

    if (!organizationId || !phoneNumber || !countryCode) {
      return jsonError('organizationId, phoneNumber, and countryCode are required', 400)
    }

    const { error } = toOrgScope(principal, organizationId)
    if (error) return error

    const inbox = await prisma.phoneInbox.create({
      data: {
        organizationId,
        userId: principal.userId,
        phoneNumber,
        countryCode,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
})
