import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.fn()
const apiKeyFindUniqueMock = vi.fn()
const apiKeyDeleteMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUserMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findUnique: (...args: unknown[]) => apiKeyFindUniqueMock(...args),
      delete: (...args: unknown[]) => apiKeyDeleteMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/v1/apiKeys/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    getAuthenticatedUserMock.mockResolvedValue({
      id: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('returns the sanitized metadata contract', async () => {
    apiKeyFindUniqueMock.mockResolvedValue({
      id: 'key_1',
      apiKey: 'sk_live_secret',
      keyHash: 'hash',
      prefix: 'sk_live_secr',
      name: 'Production Key',
      organizationId: 'org_1',
      userId: 'user_1',
      scopes: ['inboxes:read'],
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
    })

    const { GET } = await loadRoute()
    const response = await GET(new Request('http://localhost/api/v1/apiKeys/key_1') as any, {
      params: Promise.resolve({ id: 'key_1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      id: 'key_1',
      prefix: 'sk_live_secr',
      name: 'Production Key',
      organizationId: 'org_1',
      userId: 'user_1',
      scopes: ['inboxes:read'],
      createdAt: '2026-05-18T00:00:00.000Z',
    })
    expect(body.data).not.toHaveProperty('apiKey')
    expect(body.data).not.toHaveProperty('keyHash')
  })
})

describe('DELETE /api/v1/apiKeys/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    getAuthenticatedUserMock.mockResolvedValue({
      id: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('deletes an owned key', async () => {
    apiKeyFindUniqueMock.mockResolvedValue({
      id: 'key_1',
      userId: 'user_1',
    })
    apiKeyDeleteMock.mockResolvedValue({})

    const { DELETE } = await loadRoute()
    const response = await DELETE(new Request('http://localhost/api/v1/apiKeys/key_1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer token' },
    }) as any, {
      params: Promise.resolve({ id: 'key_1' }),
    })

    expect(response.status).toBe(204)
    expect(apiKeyDeleteMock).toHaveBeenCalledWith({ where: { id: 'key_1' } })
  })
})
