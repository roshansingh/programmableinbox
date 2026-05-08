import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(inbox)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  try {
    const { email, name } = await request.json()

    const updated = await prisma.emailInbox.update({
      where: { id },
      data: {
        ...(email !== undefined && { email }),
        ...(name !== undefined && { name }),
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

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  await prisma.emailInbox.delete({ where: { id } })

  return new Response(null, { status: 204 })
}
