import crypto from 'crypto'
import { prisma } from '@/lib/db'

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
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      keyHash: hashApiKey(rawKey),
      prefix: getApiKeyPrefix(rawKey),
    },
    select: {
      id: true,
      organizationId: true,
      scopes: true,
    },
  })

  if (!apiKey) return null

  return {
    kind: 'apiKey',
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    scopes: apiKey.scopes,
  }
}
