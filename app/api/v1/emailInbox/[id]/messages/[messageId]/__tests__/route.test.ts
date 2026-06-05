import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAuthContextMock = vi.fn()
const emailInboxFindUniqueMock = vi.fn()
const emailMessageFindUniqueMock = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: (...args: unknown[]) => resolveAuthContextMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findUnique: (...args: unknown[]) => emailInboxFindUniqueMock(...args),
    },
    emailMessage: {
      findUnique: (...args: unknown[]) => emailMessageFindUniqueMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/v1/emailInbox/[id]/messages/[messageId]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns a message with user JWT token', async () => {
    const userId = 'user_1'
    const inboxId = 'inbox_1'
    const messageId = 'msg_1'
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

    emailMessageFindUniqueMock.mockResolvedValue({
      id: messageId,
      inboxEmailAddressId: inboxId,
      from: 'sender@example.com',
      subject: 'Test',
      threadId: 'thread_1',
      createdAt: new Date(),
    })

    const { GET } = await loadRoute()
    const response = await GET(
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_1'),
      { params: Promise.resolve({ id: inboxId, messageId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.id).toBe(messageId)
  })

  it('returns 401 without authentication', async () => {
    resolveAuthContextMock.mockResolvedValue(null)

    const { GET } = await loadRoute()
    const response = await GET(
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_1'),
      { params: Promise.resolve({ id: 'inbox_1', messageId: 'msg_1' }) } as any
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
      new Request('http://localhost/api/v1/emailInbox/inbox_invalid/messages/msg_1'),
      { params: Promise.resolve({ id: 'inbox_invalid', messageId: 'msg_1' }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.message).toBe('Not found')
  })

  it('returns 404 when message not found', async () => {
    const inboxId = 'inbox_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      email: 'user@example.com',
      memberships: [{ organizationId: orgId, role: 'owner' }],
    })

    emailInboxFindUniqueMock.mockResolvedValue({
      id: inboxId,
      organizationId: orgId,
      userId: 'user_1',
      email: 'test@example.com',
      name: 'Test Inbox',
    })

    emailMessageFindUniqueMock.mockResolvedValue(null)

    const { GET } = await loadRoute()
    const response = await GET(
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_invalid'),
      { params: Promise.resolve({ id: inboxId, messageId: 'msg_invalid' }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.message).toBe('Message not found')
  })

  it('returns message with API key auth', async () => {
    const inboxId = 'inbox_1'
    const messageId = 'msg_1'
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

    emailMessageFindUniqueMock.mockResolvedValue({
      id: messageId,
      inboxEmailAddressId: inboxId,
      from: 'sender@example.com',
      subject: 'Test',
      threadId: 'thread_1',
      createdAt: new Date(),
    })

    const { GET } = await loadRoute()
    const response = await GET(
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_1'),
      { params: Promise.resolve({ id: inboxId, messageId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.id).toBe(messageId)
  })

  it('returns 403 when API key lacks messages:read scope', async () => {
    const inboxId = 'inbox_1'
    const orgId = 'org_1'

    resolveAuthContextMock.mockResolvedValue({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: orgId,
      scopes: ['inboxes:read'],
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
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_1'),
      { params: Promise.resolve({ id: inboxId, messageId: 'msg_1' }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain('Missing required scope')
  })

  it('returns 404 when message is in different inbox', async () => {
    const inboxId = 'inbox_1'
    const messageId = 'msg_1'
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

    emailMessageFindUniqueMock.mockResolvedValue({
      id: messageId,
      inboxEmailAddressId: 'different_inbox',
      from: 'sender@example.com',
      subject: 'Test',
      threadId: 'thread_1',
      createdAt: new Date(),
    })

    const { GET } = await loadRoute()
    const response = await GET(
      new Request('http://localhost/api/v1/emailInbox/inbox_1/messages/msg_1'),
      { params: Promise.resolve({ id: inboxId, messageId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.message).toBe('Message not found')
  })
})
