import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError, isUniqueViolation } from '@/lib/api-helpers'
import logger from '@/lib/logger'

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
  } catch (error) {
    // Renaming an inbox onto an address another inbox already holds (F1).
    if (isUniqueViolation(error, 'email')) {
      return jsonError('Email address is not available', 409)
    }
    logger.error({ error, inboxId: id }, 'Failed to update email inbox')
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

  // Soft delete (F8). The inbox and its messages both become unreachable: the
  // client extension in lib/db.ts filters `deletedAt: null` on every read, and
  // the messages are stamped in the same transaction so neither can be served
  // while the other is hidden.
  //
  // The row is kept rather than removed so its address stays claimed by the
  // unique index (F1) — a deleted inbox's address can never be reclaimed by
  // another org and start receiving its mail.
  const deletedAt = new Date()
  await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { inboxEmailAddressId: id, deletedAt: null },
      data: { deletedAt },
    }),
    prisma.emailInbox.update({ where: { id }, data: { deletedAt } }),
  ])

  return new Response(null, { status: 204 })
}
