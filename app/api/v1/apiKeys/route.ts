import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const organizationId = request.nextUrl.searchParams.get('organizationId')

  const where: { userId: string; organizationId?: string } = { userId: user.id }
  if (organizationId) where.organizationId = organizationId

  const keys = await prisma.apiKey.findMany({ where })

  return jsonSuccess(keys)
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  try {
    const { organizationId, name } = await request.json()

    if (!organizationId || !name) {
      return jsonError('organizationId and name are required', 400)
    }

    const membership = user.memberships.find((m) => m.organizationId === organizationId)
    if (!membership) {
      return jsonError('Not a member of this organization', 403)
    }

    const apiKey = crypto.randomBytes(32).toString('hex')

    const key = await prisma.apiKey.create({
      data: {
        apiKey,
        name,
        organizationId,
        userId: user.id,
      },
    })

    return jsonSuccess(key, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
}
