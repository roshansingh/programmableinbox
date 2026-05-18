import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

const API_KEY_SCOPES = new Set(['inboxes:read', 'messages:read'])
const API_KEY_PREFIX_LENGTH = 12

function getKeyPrefix(rawKey: string) {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH)
}

function hashApiKey(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

function serializeApiKey(key: {
  id: string
  apiKey: string | null
  prefix: string | null
  name: string
  organizationId: string
  userId: string
  scopes: string[]
  createdAt: Date
}) {
  return {
    id: key.id,
    prefix: key.prefix ?? (key.apiKey ? getKeyPrefix(key.apiKey) : ''),
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

  const where: { userId: string; organizationId?: string } = { userId: user.id }
  if (organizationId) where.organizationId = organizationId

  const keys = await prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
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

    const normalizedName = name.trim()
    const normalizedScopes = Array.from(
      new Set(
        scopes.filter((scope): scope is string => typeof scope === 'string' && API_KEY_SCOPES.has(scope))
      )
    )

    if (!normalizedName) {
      return jsonError('name is required', 400)
    }

    if (normalizedScopes.length === 0) {
      return jsonError('At least one valid scope is required', 400)
    }

    if (normalizedScopes.length !== scopes.length) {
      return jsonError('Invalid scope requested', 400)
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
  } catch {
    return jsonError('Internal server error', 500)
  }
}
