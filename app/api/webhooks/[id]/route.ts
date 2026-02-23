import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

async function getWebhookForUser(id: string, orgIds: string[]) {
  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook || !orgIds.includes(webhook.organizationId)) return null
  return webhook
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params
  const orgIds = user.memberships.map((m) => m.organizationId)

  const webhook = await getWebhookForUser(id, orgIds)
  if (!webhook) return jsonError('Not found', 404)

  return jsonSuccess(webhook)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params
  const orgIds = user.memberships.map((m) => m.organizationId)

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
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params
  const orgIds = user.memberships.map((m) => m.organizationId)

  const webhook = await getWebhookForUser(id, orgIds)
  if (!webhook) return jsonError('Not found', 404)

  await prisma.webhook.delete({ where: { id } })

  return new Response(null, { status: 204 })
}
