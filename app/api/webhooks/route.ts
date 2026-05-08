import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { WebhookStatus } from '@/lib/generated/prisma/client'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const status = searchParams.get('status') as WebhookStatus | null

  const orgIds = user.memberships.map((m) => m.organizationId)

  const where: { organizationId: { in: string[] }; status?: WebhookStatus } = {
    organizationId: { in: orgIds },
  }
  if (status) where.status = status

  const [webhooks, total] = await Promise.all([
    prisma.webhook.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.webhook.count({ where }),
  ])

  return jsonSuccess({ webhooks, total, page, limit })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  try {
    const { name, url, events, secret } = await request.json()

    if (!name || !url || !events?.length) {
      return jsonError('name, url, and events are required', 400)
    }

    const firstMembership = user.memberships[0]
    if (!firstMembership) {
      return jsonError('No organization found', 400)
    }

    const webhook = await prisma.webhook.create({
      data: {
        name,
        url,
        events,
        organizationId: firstMembership.organizationId,
        secret: secret || null,
      },
    })

    return jsonSuccess(webhook, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
}
