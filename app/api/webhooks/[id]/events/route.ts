import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { WebhookEventStatus } from '@/lib/generated/prisma/client'
import { parsePagination, OffsetTooLargeError } from '@/lib/pagination/params'

/** Mirrors `enum WebhookEventStatus` in prisma/schema.prisma. */
const WEBHOOK_EVENT_STATUSES: readonly WebhookEventStatus[] = ['pending', 'delivered', 'failed']

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params
  const orgIds = user.memberships.map((m) => m.organizationId)

  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook || !orgIds.includes(webhook.organizationId)) {
    return jsonError('Not found', 404)
  }

  const searchParams = request.nextUrl.searchParams

  let page: number
  let limit: number
  let skip: number
  try {
    ;({ page, limit, skip } = parsePagination(searchParams, { defaultLimit: 20 }))
  } catch (error) {
    if (error instanceof OffsetTooLargeError) return jsonError(error.message, 400)
    throw error
  }

  // Validate rather than cast — see the note in app/api/webhooks/route.ts.
  const rawStatus = searchParams.get('status')
  if (rawStatus !== null && !WEBHOOK_EVENT_STATUSES.includes(rawStatus as WebhookEventStatus)) {
    return jsonError(`status must be one of: ${WEBHOOK_EVENT_STATUSES.join(', ')}`, 400)
  }
  const status = rawStatus as WebhookEventStatus | null

  const where: { webhookId: string; status?: WebhookEventStatus } = { webhookId: id }
  if (status) where.status = status

  const [events, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.webhookEvent.count({ where }),
  ])

  return jsonSuccess({ events, total, page, limit })
}
