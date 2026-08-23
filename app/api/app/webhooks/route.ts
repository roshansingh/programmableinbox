import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import { WebhookStatus } from '@/lib/generated/prisma/client'
import { parsePagination, OffsetTooLargeError } from '@/lib/pagination/params'
import { config } from '@/lib/config'
import { captureEvent, PRODUCT_ANALYTICS_EVENTS } from '@/ee/product-analytics/capture'

/** Mirrors `enum WebhookStatus` in prisma/schema.prisma. */
const WEBHOOK_STATUSES: readonly WebhookStatus[] = ['active', 'inactive', 'failing']

export const GET = withUser(async (request, principal) => {

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

  const orgIds = principal.memberships.map((m) => m.organizationId)

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
})

export const POST = withUser(async (request, principal) => {

  try {
    const { name, url, events, secret } = await request.json()

    if (!name || !url || !events?.length) {
      return jsonError('name, url, and events are required', 400)
    }

    const firstMembership = principal.memberships[0]
    if (!firstMembership) {
      return jsonError('No organization found', 400)
    }

    const { organizationId } = firstMembership
    const denial = await checkResourceLimit(organizationId, 'webhooks', 'webhook', () =>
      prisma.webhook.count({ where: { organizationId } }),
    )
    if (denial) {
      if (config.productAnalytics.enabled) {
        captureEvent(PRODUCT_ANALYTICS_EVENTS.planLimitDenied, principal.userId, {
          resource: 'webhooks',
          limit: denial.limit,
          used: denial.used,
          planCode: denial.planCode,
        })
      }
      return jsonPlanDenial(denial)
    }

    const webhook = await prisma.webhook.create({
      data: {
        name,
        url,
        events,
        organizationId,
        secret: secret || null,
      },
    })

    if (config.productAnalytics.enabled) {
      captureEvent(PRODUCT_ANALYTICS_EVENTS.webhookCreated, principal.userId, {
        webhookId: webhook.id,
        organizationId,
      })
    }

    return jsonSuccess(webhook, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
})
