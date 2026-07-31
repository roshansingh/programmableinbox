import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

async function getWebhookForUser(id: string, orgIds: string[]) {
  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook || !orgIds.includes(webhook.organizationId)) return null
  return webhook
}

export const GET = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const orgIds = principal.memberships.map((m) => m.organizationId)

  const webhook = await getWebhookForUser(id, orgIds)
  if (!webhook) return jsonError('Not found', 404)

  return jsonSuccess(webhook)
})

export const PATCH = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const orgIds = principal.memberships.map((m) => m.organizationId)

  const webhook = await getWebhookForUser(id, orgIds)
  if (!webhook) return jsonError('Not found', 404)

  try {
    const { name, url, events, status, secret } = await request.json()

    const updated = await prisma.webhook.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(url !== undefined && { url }),
        ...(events !== undefined && { events }),
        ...(status !== undefined && { status }),
        ...(secret !== undefined && { secret }),
      },
    })

    return jsonSuccess(updated)
  } catch {
    return jsonError('Internal server error', 500)
  }
})

export const DELETE = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const orgIds = principal.memberships.map((m) => m.organizationId)

  const webhook = await getWebhookForUser(id, orgIds)
  if (!webhook) return jsonError('Not found', 404)

  // Soft delete (F8). Delivery history in webhook_events is preserved.
  await prisma.webhook.update({ where: { id }, data: { deletedAt: new Date() } })

  return new Response(null, { status: 204 })
})
