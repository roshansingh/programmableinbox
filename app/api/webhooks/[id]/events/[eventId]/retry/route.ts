import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string; eventId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id, eventId } = await params
  const orgIds = user.memberships.map((m) => m.organizationId)

  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook || !orgIds.includes(webhook.organizationId)) {
    return jsonError('Not found', 404)
  }

  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } })
  if (!event || event.webhookId !== id) {
    return jsonError('Event not found', 404)
  }

  const updated = await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: 'pending',
      attempts: { increment: 1 },
    },
  })

  return jsonSuccess(updated)
}
