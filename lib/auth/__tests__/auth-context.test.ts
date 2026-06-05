import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const apiKeyFindFirstMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) => resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findFirst: (...args: unknown[]) => apiKeyFindFirstMock(...args),
    },
  },
}))

async function loadModule() {
  return await import('../auth-context')
}

describe('resolveAuthContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('resolves a JWT bearer token to a normalized user principal', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      email: 'person@example.com',
      memberships: [{ organizationId: 'org_1', role: 'owner' }],
    })

    const { resolveAuthContext } = await loadModule()
    const request = new NextRequest('http://localhost/api/v1/inboxes', {
      headers: { authorization: 'Bearer jwt-token' },
    })

    const result = await resolveAuthContext(request)

    expect(result).toEqual({
      kind: 'user',
      userId: 'user_1',
      email: 'person@example.com',
      memberships: [{ organizationId: 'org_1', role: 'owner' }],
    })
    expect(resolveUserPrincipalFromTokenMock).toHaveBeenCalledWith('jwt-token')
    expect(apiKeyFindFirstMock).not.toHaveBeenCalled()
  })

  it('resolves an API key bearer token to an API-key principal', async () => {
    const rawKey = 'sk_live_abcd1234567890'
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

    resolveUserPrincipalFromTokenMock.mockResolvedValue(null)
    apiKeyFindFirstMock.mockResolvedValue({
      id: 'key_1',
      organizationId: 'org_1',
      scopes: ['inboxes:read', 'messages:read'],
    })

    const { resolveAuthContext } = await loadModule()
    const request = new NextRequest('http://localhost/api/v1/inboxes', {
      headers: { authorization: `Bearer ${rawKey}` },
    })

    const result = await resolveAuthContext(request)

    expect(result).toEqual({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: 'org_1',
      scopes: ['inboxes:read', 'messages:read'],
    })
    expect(apiKeyFindFirstMock).toHaveBeenCalledWith({
      where: {
        keyHash,
        prefix: 'sk_live_abcd',
      },
      select: {
        id: true,
        organizationId: true,
        scopes: true,
      },
    })
  })

  it('returns null when the bearer credential matches neither a JWT nor an API key', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(null)
    apiKeyFindFirstMock.mockResolvedValue(null)

    const { resolveAuthContext } = await loadModule()
    const request = new NextRequest('http://localhost/api/v1/inboxes', {
      headers: { authorization: 'Bearer not-a-valid-credential' },
    })

    const result = await resolveAuthContext(request)

    expect(result).toBeNull()
  })

  it('returns null when the authorization header is missing', async () => {
    const { resolveAuthContext } = await loadModule()
    const request = new NextRequest('http://localhost/api/v1/inboxes')

    const result = await resolveAuthContext(request)

    expect(result).toBeNull()
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
    expect(apiKeyFindFirstMock).not.toHaveBeenCalled()
  })
})
