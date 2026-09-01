import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const apiKeyFindManyMock = vi.fn()
const apiKeyCreateMock = vi.fn()
const apiKeyCountMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: (...args: unknown[]) => apiKeyFindManyMock(...args),
      create: (...args: unknown[]) => apiKeyCreateMock(...args),
      count: (...args: unknown[]) => apiKeyCountMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/app/apiKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
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
        scopes: ['email_inboxes:read', 'email_messages:read'],
        createdAt: new Date('2026-05-18T00:00:00.000Z'),
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/app/apiKeys', { headers: { cookie: 'session=jwt.token.here' } }), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      {
        id: 'key_1',
        prefix: 'sk_live_secr',
        name: 'Production Key',
        organizationId: 'org_1',
        userId: 'user_1',
        scopes: ['email_inboxes:read', 'email_messages:read'],
        createdAt: '2026-05-18T00:00:00.000Z',
      },
    ])
    expect(body.data[0]).not.toHaveProperty('apiKey')
    expect(body.data[0]).not.toHaveProperty('keyHash')
  })
})

describe('POST /api/app/apiKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('rejects invalid scopes', async () => {
    const { POST } = await loadRoute()
    const request = new NextRequest('http://localhost/api/app/apiKeys', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        name: 'Bad Key',
        scopes: ['totally:wrong'],
      }),
      headers: {
        'content-type': 'application/json',
        cookie: 'session=token',
      },
    })

    const response = await POST(request as any, { params: Promise.resolve({}) })
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
      scopes: ['email_inboxes:read'],
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
    })

    const { POST } = await loadRoute()
    const request = new NextRequest('http://localhost/api/app/apiKeys', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        name: 'Partner Key',
        scopes: ['email_inboxes:read'],
      }),
      headers: {
        'content-type': 'application/json',
        cookie: 'session=token',
      },
    })

    const response = await POST(request as any, { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toEqual(
      expect.objectContaining({
        id: 'key_new',
        prefix: 'sk_live_abcd',
        name: 'Partner Key',
        organizationId: 'org_1',
        userId: 'user_1',
        scopes: ['email_inboxes:read'],
        apiKey: expect.stringMatching(/^sk_live_/),
      })
    )
    expect(body.data).not.toHaveProperty('keyHash')
  })
})

/**
 * `ApiKey` is the one count cap that cannot rely on the soft-delete extension:
 * it tracks lifecycle with `revokedAt`/`expiresAt` and is deliberately not in
 * `SOFT_DELETE_MODELS`, so a bare `count()` tallies dead credentials and a user
 * who rotates a key three times on a three-key plan is locked out permanently.
 */
describe('POST /api/app/apiKeys plan limit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  async function configurePlan(apiKeys: number | null) {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
    CommercialProvider.configure(
      {
        resolve: async () => ({
          planCode: 'free',
          planName: 'Free',
          limits: { ...UNLIMITED, apiKeys },
          periodStart: null,
          periodEnd: null,
        }),
      },
      CommercialProvider.quota,
      CommercialProvider.metering,
    )
    return CommercialProvider
  }

  function createRequest() {
    return new NextRequest('http://localhost:3000/api/app/apiKeys', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        name: 'Another Key',
        scopes: ['email_inboxes:read'],
      }),
      headers: {
        'content-type': 'application/json',
        cookie: 'session=token',
      },
    })
  }

  const CREATED_KEY = {
    id: 'key_new',
    prefix: 'sk_live_abcd',
    name: 'Another Key',
    organizationId: 'org_1',
    userId: 'user_1',
    scopes: ['email_inboxes:read'],
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
  }

  it('refuses with 402 once the organization is at its key limit', async () => {
    const provider = await configurePlan(2)
    apiKeyCountMock.mockResolvedValue(2)
    const { POST } = await loadRoute()

    const response = await POST(createRequest() as any, { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.limit).toBe(2)
    expect(body.used).toBe(2)
    expect(body.planCode).toBe('free')
    expect(apiKeyCreateMock).not.toHaveBeenCalled()
    provider.reset()
  })

  it('excludes revoked and expired keys from the count', async () => {
    const provider = await configurePlan(2)
    apiKeyCountMock.mockResolvedValue(0)
    apiKeyCreateMock.mockResolvedValue(CREATED_KEY)
    const { POST } = await loadRoute()

    await POST(createRequest() as any, { params: Promise.resolve({}) })

    expect(apiKeyCountMock).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    })
    provider.reset()
  })

  it('does not count at all under the unlimited default', async () => {
    apiKeyCreateMock.mockResolvedValue(CREATED_KEY)
    const { POST } = await loadRoute()

    const response = await POST(createRequest() as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect(apiKeyCountMock).not.toHaveBeenCalled()
  })
})
