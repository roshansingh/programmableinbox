import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import { config } from '@/lib/config'
import { captureEvent, PRODUCT_ANALYTICS_EVENTS } from '@/lib/product-analytics/capture'
import logger from '@/lib/logger'
import { API_KEY_SCOPE_SET } from '@/lib/api-key-scopes'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'

const API_KEY_PREFIX_LENGTH = 12

export type SerializableApiKey = {
  id: string
  apiKey: string | null
  prefix: string | null
  name: string
  organizationId: string
  userId: string
  scopes: string[]
  createdAt: Date
}

function getKeyPrefix(rawKey: string) {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH)
}

function hashApiKey(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export function serializeApiKey(key: SerializableApiKey) {
  return {
    id: key.id,
    prefix:
      key.prefix ??
      (key.apiKey ? getKeyPrefix(key.apiKey) : `legacy_${key.id.slice(0, API_KEY_PREFIX_LENGTH)}`),
    name: key.name,
    organizationId: key.organizationId,
    userId: key.userId,
    scopes: key.scopes,
    createdAt: key.createdAt.toISOString(),
  }
}

export const GET = withUser(async (request, principal) => {

  const organizationId = request.nextUrl.searchParams.get('organizationId')

  if (organizationId) {
    const { error } = toOrgScope(principal, organizationId)
    if (error) return error
  }

  // Revoked keys are hidden here rather than by the soft-delete extension in
  // lib/db.ts: ApiKey tracks its lifecycle with `revokedAt` (F5), not the
  // `deletedAt` column that extension keys off.
  const where: { userId: string; organizationId?: string; revokedAt: null } = {
    userId: principal.userId,
    revokedAt: null,
  }
  if (organizationId) where.organizationId = organizationId

  const keys = await prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_UNPAGINATED_ROWS,
  })

  return jsonSuccess(keys.map(serializeApiKey))
})

export const POST = withUser(async (request, principal) => {

  try {
    const { organizationId, name, scopes } = await request.json()

    if (!organizationId || !name || !Array.isArray(scopes)) {
      return jsonError('organizationId, name, and scopes are required', 400)
    }

    if (typeof organizationId !== 'string' || typeof name !== 'string') {
      return jsonError('organizationId and name must be strings', 400)
    }

    const normalizedName = name.trim()
    const filteredScopes = scopes.filter((scope): scope is string => typeof scope === 'string')
    const normalizedScopes = Array.from(
      new Set(filteredScopes.filter((scope) => API_KEY_SCOPE_SET.has(scope)))
    )

    if (!normalizedName) {
      return jsonError('name is required', 400)
    }

    if (filteredScopes.length !== scopes.length || normalizedScopes.length !== scopes.length) {
      return jsonError('Invalid scope requested', 400)
    }

    if (normalizedScopes.length === 0) {
      return jsonError('At least one valid scope is required', 400)
    }

    const { error } = toOrgScope(principal, organizationId)
    if (error) return error

    // `ApiKey` is not in SOFT_DELETE_MODELS — it tracks lifecycle with
    // `revokedAt`/`expiresAt` rather than `deletedAt` — so the extension does
    // not filter this count and it has to be written by hand. Counting dead
    // credentials would mean a user who rotates a key three times on a
    // three-key plan can never mint another one.
    const denial = await checkResourceLimit(organizationId, 'apiKeys', 'API key', () =>
      prisma.apiKey.count({
        where: {
          organizationId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    )
    if (denial) {
      if (config.productAnalytics.enabled) {
        captureEvent(PRODUCT_ANALYTICS_EVENTS.planLimitDenied, principal.userId, {
          resource: 'apiKeys',
          limit: denial.limit,
          used: denial.used,
          planCode: denial.planCode,
        })
      }
      return jsonPlanDenial(denial)
    }

    const apiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`
    const prefix = getKeyPrefix(apiKey)
    const keyHash = hashApiKey(apiKey)

    const key = await prisma.apiKey.create({
      data: {
        apiKey: null,
        keyHash,
        prefix,
        name: normalizedName,
        scopes: normalizedScopes,
        organizationId,
        userId: principal.userId,
      },
    })

    if (config.productAnalytics.enabled) {
      captureEvent(PRODUCT_ANALYTICS_EVENTS.apiKeyCreated, principal.userId, {
        apiKeyId: key.id,
        organizationId,
      })
    }

    return jsonSuccess(
      {
        ...serializeApiKey(key),
        apiKey,
      },
      201
    )
  } catch (error) {
    logger.error({ error }, 'Error creating API key')
    return jsonError('Internal server error', 500)
  }
})
