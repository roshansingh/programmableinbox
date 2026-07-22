import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { WebhookStatus } from '@/lib/generated/prisma/client'
import { parsePagination, OffsetTooLargeError } from '@/lib/pagination/params'

/** Mirrors `enum WebhookStatus` in prisma/schema.prisma. */
const WEBHOOK_STATUSES: readonly WebhookStatus[] = ['active', 'inactive', 'failing']

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

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

  // Validate rather than cast: an unknown value reaches Prisma as an invalid
  // enum member and surfaces as an unhandled 500 for what is a bad client
  // parameter. The cast asserted a guarantee the query string cannot provide.
  const rawStatus = searchParams.get('status')
  if (rawStatus !== null && !WEBHOOK_STATUSES.includes(rawStatus as WebhookStatus)) {
    return jsonError(`status must be one of: ${WEBHOOK_STATUSES.join(', ')}`, 400)
  }
  const status = rawStatus as WebhookStatus | null

  const orgIds = user.memberships.map((m) => m.organizationId)

  const where: { organizationId: { in: string[] }; status?: WebhookStatus } = {
    organizationId: { in: orgIds },
  }
  if (status) where.status = status

  const [webhooks, total] = await Promise.all([
    prisma.webhook.findMany({
      where,
      skip,
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
