import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(inbox)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  try {
    const { phoneNumber, countryCode } = await request.json()

    const updated = await prisma.phoneInbox.update({
      where: { id },
      data: {
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(countryCode !== undefined && { countryCode }),
      },
    })

    return jsonSuccess(updated)
  } catch {
    return jsonError('Internal server error', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  // Soft delete (F8).
  await prisma.phoneInbox.update({ where: { id }, data: { deletedAt: new Date() } })

  return new Response(null, { status: 204 })
}
