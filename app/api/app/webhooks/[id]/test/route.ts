import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const orgIds = principal.memberships.map((m) => m.organizationId)

  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook || !orgIds.includes(webhook.organizationId)) {
    return jsonError('Not found', 404)
  }

  const event = await prisma.webhookEvent.create({
    data: {
      webhookId: id,
      event: 'test',
      payload: {
        type: 'test',
        message: 'This is a test webhook event',
        timestamp: new Date().toISOString(),
      },
      status: 'pending',
    },
  })

  await prisma.webhook.update({
    where: { id },
    data: { lastTriggered: new Date() },
  })

  return jsonSuccess(event)
})
