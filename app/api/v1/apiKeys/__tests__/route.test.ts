import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthenticatedUserMock = vi.fn()
const apiKeyFindManyMock = vi.fn()
const apiKeyCreateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUserMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: (...args: unknown[]) => apiKeyFindManyMock(...args),
      create: (...args: unknown[]) => apiKeyCreateMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/v1/apiKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    getAuthenticatedUserMock.mockResolvedValue({
      id: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('returns metadata-only api key entries', async () => {
    apiKeyFindManyMock.mockResolvedValue([
      {
        id: 'key_1',
        apiKey: 'sk_live_secret',
        keyHash: 'hash',
        prefix: 'sk_live_secr',
        name: 'Production Key',
        organizationId: 'org_1',
        userId: 'user_1',
        scopes: ['inboxes:read', 'messages:read'],
        createdAt: new Date('2026-05-18T00:00:00.000Z'),
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/apiKeys'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      {
        id: 'key_1',
        prefix: 'sk_live_secr',
        name: 'Production Key',
        organizationId: 'org_1',
        userId: 'user_1',
        scopes: ['inboxes:read', 'messages:read'],
        createdAt: '2026-05-18T00:00:00.000Z',
      },
    ])
    expect(body.data[0]).not.toHaveProperty('apiKey')
    expect(body.data[0]).not.toHaveProperty('keyHash')
  })
})

describe('POST /api/v1/apiKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    getAuthenticatedUserMock.mockResolvedValue({
      id: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('rejects invalid scopes', async () => {
    const { POST } = await loadRoute()
    const request = new Request('http://localhost/api/v1/apiKeys', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        name: 'Bad Key',
        scopes: ['totally:wrong'],
      }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toBe('Invalid scope requested')
    expect(apiKeyCreateMock).not.toHaveBeenCalled()
  })

  it('creates a scoped api key and returns the raw key once', async () => {
    apiKeyCreateMock.mockResolvedValue({
      id: 'key_new',
      apiKey: null,
      keyHash: 'hash',
      prefix: 'sk_live_abcd',
      name: 'Partner Key',
      organizationId: 'org_1',
      userId: 'user_1',
      scopes: ['inboxes:read'],
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
    })

    const { POST } = await loadRoute()
    const request = new Request('http://localhost/api/v1/apiKeys', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        name: 'Partner Key',
        scopes: ['inboxes:read'],
      }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toEqual(
      expect.objectContaining({
        id: 'key_new',
        prefix: 'sk_live_abcd',
        name: 'Partner Key',
        organizationId: 'org_1',
        userId: 'user_1',
        scopes: ['inboxes:read'],
        apiKey: expect.stringMatching(/^sk_live_/),
      })
    )
    expect(body.data).not.toHaveProperty('keyHash')
  })
})
