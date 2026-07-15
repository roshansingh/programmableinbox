import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveAuthContextMock = vi.fn()
const emailInboxFindUniqueMock = vi.fn()
const emailMessageFindManyMock = vi.fn()

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
    },
  },
}))

const fetchGroupedThreadHeadsMock = vi.fn()
vi.mock('../grouped-query', () => ({
  fetchGroupedThreadHeads: (...args: unknown[]) => fetchGroupedThreadHeadsMock(...args),
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

    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: inboxId }) } as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.messages).toHaveLength(1)
    expect(body.data.hasMore).toBe(false)
    expect(body.data.nextCursor).toBeNull()
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

  it('returns nextCursor and hasMore=true when more rows exist', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user', userId: 'u1', email: 'u@e.com',
      memberships: [{ organizationId: 'o1', role: 'owner' }],
    })
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'o1', userId: 'u1' })
    // limit defaults to 50 → route fetches 51; return 51 so hasMore is true
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `msg_${i}`, threadId: 't', inboxEmailAddressId: 'inbox_1',
      createdAt: new Date(Date.now() - i * 1000),
    }))
    emailMessageFindManyMock.mockResolvedValue(rows)

    const { GET } = await loadRoute()
    const res = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages'),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any,
    )
    const body = await res.json()
    expect(body.data.messages).toHaveLength(50)
    expect(body.data.hasMore).toBe(true)
    expect(typeof body.data.nextCursor).toBe('string')
  })

  it('applies a keyset filter when a cursor is supplied', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user', userId: 'u1', email: 'u@e.com',
      memberships: [{ organizationId: 'o1', role: 'owner' }],
    })
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'o1', userId: 'u1' })
    emailMessageFindManyMock.mockResolvedValue([])

    const { encodeCursor } = await import('@/lib/pagination/cursor')
    const cursor = encodeCursor({ createdAt: new Date('2026-07-13T00:00:00.000Z'), id: 'msg_10' })

    const { GET } = await loadRoute()
    await GET(
      new NextRequest(`http://localhost/api/v1/emailInbox/inbox_1/messages?cursor=${cursor}`),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any,
    )
    const findArgs = emailMessageFindManyMock.mock.calls[0][0]
    const boundary = new Date('2026-07-13T00:00:00.000Z')
    expect(findArgs.where.OR).toEqual([
      { createdAt: { lt: boundary } },
      { createdAt: boundary, id: { lt: 'msg_10' } },
    ])
    expect(findArgs.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    expect(findArgs.take).toBe(51)
  })

  it('applies a keyset filter with thread mode (ascending, greater-than)', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user', userId: 'u1', email: 'u@e.com',
      memberships: [{ organizationId: 'o1', role: 'owner' }],
    })
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'o1', userId: 'u1' })
    emailMessageFindManyMock.mockResolvedValue([])

    const { encodeCursor } = await import('@/lib/pagination/cursor')
    const cursor = encodeCursor({ createdAt: new Date('2026-07-13T00:00:00.000Z'), id: 'msg_10' })

    const { GET } = await loadRoute()
    await GET(
      new NextRequest(`http://localhost/api/v1/emailInbox/inbox_1/messages?threadId=t1&cursor=${cursor}`),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any,
    )
    const findArgs = emailMessageFindManyMock.mock.calls[0][0]
    const boundary = new Date('2026-07-13T00:00:00.000Z')
    expect(findArgs.where.threadId).toBe('t1')
    expect(findArgs.where.OR).toEqual([
      { createdAt: { gt: boundary } },
      { createdAt: boundary, id: { gt: 'msg_10' } },
    ])
    expect(findArgs.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
  })

  it('returns 400 for a malformed cursor', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user', userId: 'u1', email: 'u@e.com',
      memberships: [{ organizationId: 'o1', role: 'owner' }],
    })
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'o1', userId: 'u1' })

    const { GET } = await loadRoute()
    const res = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages?cursor=@@garbage@@'),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any,
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.message).toBe('Invalid cursor')
  })

  it('uses the grouped query and returns threadCount rows for grouped=true', async () => {
    resolveAuthContextMock.mockResolvedValue({
      kind: 'user', userId: 'u1', email: 'u@e.com',
      memberships: [{ organizationId: 'o1', role: 'owner' }],
    })
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'o1', userId: 'u1' })
    fetchGroupedThreadHeadsMock.mockResolvedValue([
      { id: 'm1', threadId: 't1', createdAt: new Date(), threadCount: 3 },
    ])

    const { GET } = await loadRoute()
    const res = await GET(
      new NextRequest('http://localhost/api/v1/emailInbox/inbox_1/messages?grouped=true'),
      { params: Promise.resolve({ id: 'inbox_1' }) } as any,
    )
    const body = await res.json()
    expect(fetchGroupedThreadHeadsMock).toHaveBeenCalledTimes(1)
    expect(emailMessageFindManyMock).not.toHaveBeenCalled()
    expect(body.data.messages[0].threadCount).toBe(3)
    expect(body.data.hasMore).toBe(false)
  })
})
