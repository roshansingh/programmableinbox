import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveAuthContextMock = vi.fn()
const emailInboxFindUniqueMock = vi.fn()
const emailMessageFindManyMock = vi.fn()
const emailMessageCountMock = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: (...args: unknown[]) => resolveAuthContextMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findUnique: (...args: unknown[]) => emailInboxFindUniqueMock(...args),
    },
    emailMessage: {
      findMany: (...args: unknown[]) => emailMessageFindManyMock(...args),
      count: (...args: unknown[]) => emailMessageCountMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/v1/emailInbox/[id]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns messages with user JWT token', async () => {
    const userId = 'user_1'
    const inboxId = 'inbox_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'user',
      userId,
      email: 'user@example.com',
      memberships: [{ organizationId: orgId, role: 'owner' }],
    })

    emailInboxFindUniqueMock.mockResolvedValue({
      id: inboxId,
      organizationId: orgId,
      userId,
      email: 'test@example.com',
      name: 'Test Inbox',
    })

    emailMessageFindManyMock.mockResolvedValue([
      {
        id: 'msg_1',
        inboxEmailAddressId: inboxId,
        from: 'sender@example.com',
        subject: 'Test',
        threadId: 'thread_1',
        createdAt: new Date(),
      },
    ])

    emailMessageCountMock.mockResolvedValue(1)

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: inboxId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.messages).toHaveLength(1)
    expect(body.data.total).toBe(1)
  })

  it('returns 401 without authentication', async () => {
    resolveAuthContextMock.mockResolvedValue(null)

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.message).toBe('Unauthorized')
  })

  it('returns 404 when inbox not found', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      email: 'user@example.com',
      memberships: [{ organizationId: 'org_1', role: 'owner' }],
    })

    emailInboxFindUniqueMock.mockResolvedValue(null)

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_invalid/messages'),
      { params: Promise.resolve({ id: 'inbox_invalid' }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.message).toBe('Not found')
  })

  it('returns messages for API key with messages:read scope', async () => {
    const inboxId = 'inbox_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: orgId,
      scopes: ['messages:read'],
    })

    emailInboxFindUniqueMock.mockResolvedValue({
      id: inboxId,
      organizationId: orgId,
      userId: 'user_1',
      email: 'test@example.com',
      name: 'Test Inbox',
    })

    emailMessageFindManyMock.mockResolvedValue([
      {
        id: 'msg_1',
        inboxEmailAddressId: inboxId,
        from: 'sender@example.com',
        subject: 'Test',
        threadId: 'thread_1',
        createdAt: new Date(),
      },
    ])

    emailMessageCountMock.mockResolvedValue(1)

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: inboxId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.messages).toHaveLength(1)
  })

  it('returns 403 when API key lacks messages:read scope', async () => {
    const inboxId = 'inbox_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: orgId,
      scopes: ['inboxes:read'], // Only inboxes:read, not messages:read
    })

    emailInboxFindUniqueMock.mockResolvedValue({
      id: inboxId,
      organizationId: orgId,
      userId: 'user_1',
      email: 'test@example.com',
      name: 'Test Inbox',
    })

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: inboxId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain('Missing required scope')
  })

  it('returns 403 when API key from different organization tries to access inbox', async () => {
    const inboxId = 'inbox_1'
    const inboxOrgId = 'org_1'
    const keyOrgId = 'org_2'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: keyOrgId,
      scopes: ['messages:read'],
    })

    emailInboxFindUniqueMock.mockResolvedValue({
      id: inboxId,
      organizationId: inboxOrgId,
      userId: 'user_1',
      email: 'test@example.com',
      name: 'Test Inbox',
    })

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: inboxId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain('Not authorized')
  })
})
