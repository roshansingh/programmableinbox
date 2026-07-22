import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError, isUniqueViolation } from '@/lib/api-helpers'
import { parseInboxAddress } from '@/lib/email-address'
import logger from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

/** Same wording as POST — see the note there on not leaking address existence. */
const ADDRESS_UNAVAILABLE = 'Email address is not available'

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

    // Re-pointing an inbox's address is a claim like any other, so it goes
    // through the same normalization and collision check as creation (F1).
    // Without this, PATCH is a second route to the same interception: claim a
    // throwaway address, then move it onto a case variant of a tenant's.
    let address: string | undefined
    if (email !== undefined) {
      const parsed = parseInboxAddress(email)
      if (!parsed) {
        return jsonError('email must be a valid email address', 400)
      }
      address = parsed

      // Friendly pre-check, scoped to *other* inboxes so re-submitting the
      // address you already hold stays a no-op. Not authoritative — soft-deleted
      // holders are invisible to reads and races slip through — so the unique
      // index remains the decider.
      const conflict = await prisma.emailInbox.findFirst({
        where: { email: address, NOT: { id } },
        select: { id: true },
      })
      if (conflict) {
        return jsonError(ADDRESS_UNAVAILABLE, 409)
      }
    }

    const updated = await prisma.emailInbox.update({
      where: { id },
      data: {
        ...(address !== undefined && { email: address }),
        ...(name !== undefined && { name }),
      },
    })

    return jsonSuccess(updated)
  } catch (error) {
    // Race-safe backstop: renaming an inbox onto an address another inbox
    // already holds, including one held by a soft-deleted inbox (F1).
    if (isUniqueViolation(error, 'email')) {
      return jsonError(ADDRESS_UNAVAILABLE, 409)
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
