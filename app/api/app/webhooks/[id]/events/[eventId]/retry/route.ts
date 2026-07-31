import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string; eventId: string }> }

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const { id, eventId } = await params
  const orgIds = principal.memberships.map((m) => m.organizationId)

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
})
