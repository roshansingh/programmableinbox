import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string; messageId: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const { id: inboxId, messageId } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
  if (!inbox) {
    return jsonError('Not found', 404)
  }

  if (context.kind === 'user') {
    if (inbox.userId !== context.userId) {
      return jsonError('Not found', 404)
    }
  } else {
    const scopeResult = requireScope(context, 'messages:read')
    if ('error' in scopeResult) {
      return scopeResult.error
    }

    const orgResult = requireOrgAccess(context, inbox.organizationId)
    if ('error' in orgResult) {
      return orgResult.error
    }
  }

  const message = await prisma.emailMessage.findUnique({
    where: { id: messageId },
  })

  if (!message || message.inboxEmailAddressId !== inboxId) {
    return jsonError('Message not found', 404)
  }

  return jsonSuccess(message)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const { id: inboxId, messageId } = await params
  const body = await request.json()

  if (typeof body.isStarred !== 'boolean') {
    return jsonError('isStarred must be a boolean', 400)
  }

  const inbox = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
  if (!inbox) return jsonError('Not found', 404)

  if (context.kind === 'user') {
    if (inbox.userId !== context.userId) return jsonError('Not found', 404)
  } else {
    const scopeResult = requireScope(context, 'messages:read')
    if ('error' in scopeResult) return scopeResult.error

    const orgResult = requireOrgAccess(context, inbox.organizationId)
    if ('error' in orgResult) return orgResult.error
  }

  const message = await prisma.emailMessage.findUnique({ where: { id: messageId } })
  if (!message || message.inboxEmailAddressId !== inboxId) return jsonError('Message not found', 404)

  const updated = await prisma.emailMessage.update({
    where: { id: messageId },
    data: { isStarred: body.isStarred },
  })

  return jsonSuccess(updated)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const { id: inboxId, messageId } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
  if (!inbox) return jsonError('Not found', 404)

  if (context.kind === 'user') {
    if (inbox.userId !== context.userId) return jsonError('Not found', 404)
  } else {
    const scopeResult = requireScope(context, 'messages:delete')
    if ('error' in scopeResult) return scopeResult.error

    const orgResult = requireOrgAccess(context, inbox.organizationId)
    if ('error' in orgResult) return orgResult.error
  }

  const message = await prisma.emailMessage.findUnique({ where: { id: messageId } })
  if (!message || message.inboxEmailAddressId !== inboxId) return jsonError('Message not found', 404)

  // Soft delete (F8): reads filter `deletedAt: null` via the client extension,
  // so the message is unreachable from this point on.
  await prisma.emailMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  })

  return jsonSuccess({ deleted: true })
}
