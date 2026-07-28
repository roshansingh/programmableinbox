import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { parseInboxAddress } from '@/lib/email-address'
import logger from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const EMAIL_IMMUTABLE =
  'The address of an inbox cannot be changed. Create a new inbox instead.'

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

    // The address is immutable once the inbox exists (F1). Re-pointing it was a
    // second route to cross-tenant interception — claim a throwaway address,
    // then move it onto a case variant of a tenant's — and it also breaks the
    // guarantee that a delivered message's recipient still names a live inbox.
    // Changing an address means creating a new inbox, not editing this one.
    //
    // A submission that matches the current address (after normalization) is a
    // no-op and allowed, so a client can PATCH the full record to rename it.
    // Anything else — a different address, or an invalid one — is refused.
    if (email !== undefined && parseInboxAddress(email) !== inbox.email) {
      return jsonError(EMAIL_IMMUTABLE, 409)
    }

    const updated = await prisma.emailInbox.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
      },
    })

    return jsonSuccess(updated)
  } catch (error) {
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
