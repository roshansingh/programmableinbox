import crypto from 'crypto'
import { prisma } from '@/lib/db'
import logger from '@/lib/logger'

const API_KEY_PREFIX_LENGTH = 12

function getApiKeyPrefix(rawKey: string) {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH)
}

function hashApiKey(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export async function resolveApiKeyPrincipal(rawKey: string): Promise<{
  kind: 'apiKey'
  apiKeyId: string
  organizationId: string
  scopes: string[]
} | null> {
  const now = new Date()

  // Revocation and expiry are enforced in the lookup itself (F5), not by a
  // post-hoc check on the result. A leaked key stops working the moment it is
  // revoked or lapses, and there is no code path that resolves a principal
  // without passing this filter.
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      keyHash: hashApiKey(rawKey),
      prefix: getApiKeyPrefix(rawKey),
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      organizationId: true,
      scopes: true,
    },
  })

  if (!apiKey) return null

  // Fire-and-forget: lastUsedAt is observability, not correctness, and every
  // authenticated request would otherwise pay for a write on the hot path. A
  // failure here must never fail the request the key was valid for.
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: now } })
    .catch((error) => logger.warn({ error, apiKeyId: apiKey.id }, 'Failed to record API key lastUsedAt'))

  return {
    kind: 'apiKey',
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    scopes: apiKey.scopes,
  }
}
