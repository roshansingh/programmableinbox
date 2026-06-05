import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveAuthContextMock = vi.fn()
const emailInboxFindManyMock = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: (...args: unknown[]) => resolveAuthContextMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findMany: (...args: unknown[]) => emailInboxFindManyMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/v1/emailInbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('lists user inboxes with JWT token', async () => {
    const userId = 'user_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'user',
      userId,
      email: 'user@example.com',
      memberships: [{ organizationId: orgId, role: 'owner' }],
    })

    emailInboxFindManyMock.mockResolvedValue([
      {
        id: 'inbox_1',
        organizationId: orgId,
        userId,
        email: 'test@example.com',
        name: 'Test Inbox',
        createdAt: new Date(),
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/emailInbox'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('inbox_1')
  })

  it('returns 401 without authentication', async () => {
    resolveAuthContextMock.mockResolvedValue(null)

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/emailInbox'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.message).toBe('Unauthorized')
  })

  it('lists inboxes for API key with inboxes:read scope', async () => {
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: orgId,
      scopes: ['inboxes:read'],
    })

    emailInboxFindManyMock.mockResolvedValue([
      {
        id: 'inbox_1',
        organizationId: orgId,
        userId: 'user_1',
        email: 'test@example.com',
        name: 'Test Inbox',
        createdAt: new Date(),
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/emailInbox'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(1)
  })

  it('returns 403 when API key lacks inboxes:read scope', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: 'org_1',
      scopes: ['messages:read'], // Only messages:read, not inboxes:read
    })

    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/emailInbox'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain('Missing required scope')
  })

  it('returns 403 when user is not member of requested organization', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      email: 'user@example.com',
      memberships: [{ organizationId: 'org_1', role: 'owner' }],
    })

    const { GET } = await loadRoute()
    const request = new NextRequest(
      'http://localhost/api/v1/emailInbox?organizationId=org_2'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain('Not a member')
  })
})
