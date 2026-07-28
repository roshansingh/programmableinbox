import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const organizationId = request.nextUrl.searchParams.get('organizationId')

  const where: { userId: string; organizationId?: string } = { userId: user.id }
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
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  try {
    const { organizationId, phoneNumber, countryCode } = await request.json()

    if (!organizationId || !phoneNumber || !countryCode) {
      return jsonError('organizationId, phoneNumber, and countryCode are required', 400)
    }

    const membership = user.memberships.find((m) => m.organizationId === organizationId)
    if (!membership) {
      return jsonError('Not a member of this organization', 403)
    }

    const inbox = await prisma.phoneInbox.create({
      data: {
        organizationId,
        userId: user.id,
        phoneNumber,
        countryCode,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
}
