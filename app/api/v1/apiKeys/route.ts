import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
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

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const organizationId = request.nextUrl.searchParams.get('organizationId')

  if (organizationId) {
    const membership = user.memberships.find((m) => m.organizationId === organizationId)
    if (!membership) {
      return jsonError('Not a member of this organization', 403)
    }
  }

  // Revoked keys are hidden here rather than by the soft-delete extension in
  // lib/db.ts: ApiKey tracks its lifecycle with `revokedAt` (F5), not the
  // `deletedAt` column that extension keys off.
  const where: { userId: string; organizationId?: string; revokedAt: null } = {
    userId: user.id,
    revokedAt: null,
  }
  if (organizationId) where.organizationId = organizationId

  const keys = await prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_UNPAGINATED_ROWS,
  })

  return jsonSuccess(keys.map(serializeApiKey))
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

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

    const membership = user.memberships.find((m) => m.organizationId === organizationId)
    if (!membership) {
      return jsonError('Not a member of this organization', 403)
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
        userId: user.id,
      },
    })

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
}
