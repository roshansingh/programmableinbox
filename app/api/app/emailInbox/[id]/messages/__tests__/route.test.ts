/**
 * Ported from the v1 suite when these routes moved to /api/app.
 *
 * The API-key cases from the original are gone — this tree is JWT-only, and a
 * key is rejected by prefix before any lookup. Pagination and clamping behavior
 * is unchanged; it now lives in listMessages rather than the handler, so these
 * assert on the Prisma calls the service makes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encodeCursor } from '@/lib/pagination/cursor'
import { MAX_LIMIT } from '@/lib/pagination/params'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailMessageFindManyMock = vi.fn()
const fetchGroupedThreadHeadsMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: (...a: unknown[]) => emailInboxFindFirstMock(...a), findMany: vi.fn() },
    emailMessage: {
      findMany: (...a: unknown[]) => emailMessageFindManyMock(...a),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/grouped-query', () => ({
  fetchGroupedThreadHeads: (...a: unknown[]) => fetchGroupedThreadHeadsMock(...a),
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'header.payload.signature'
const INBOX = { id: 'inbox_1', organizationId: 'org_1', userId: 'user_1' }

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    inboxEmailAddressId: 'inbox_1',
    threadId: 'thread_1',
    parentMessageId: null,
    subject: 'Hello',
    from: 'sender@example.com',
    to: ['a@example.com'],
    cc: [],
    bcc: [],
    text: 'body',
    html: '<p>body</p>',
    isStarred: false,
    isRead: false,
    tags: [],
    categories: [],
    extractedOtp: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    messageId: '<a@b>',
    references: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(INBOX)
  emailMessageFindManyMock.mockResolvedValue([])
})

async function get(query = '', credential = TOKEN) {
  const { GET } = await import('../route')
  return GET(
    new NextRequest(`http://localhost/api/app/emailInbox/inbox_1/messages${query}`, {
      headers: credential ? { cookie: `session=${credential}` } : {},
    }),
    { params: Promise.resolve({ id: 'inbox_1' }) },
  )
}

describe('GET /api/app/emailInbox/[id]/messages', () => {
  it('returns messages with a user JWT token', async () => {
    emailMessageFindManyMock.mockResolvedValue([message()])

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.messages).toHaveLength(1)
    expect(body.data.messages[0].id).toBe('msg_1')
  })

  it('returns 401 without authentication', async () => {
    const response = await get('', '')

    expect(response.status).toBe(401)
  })

  it('rejects an API key without attempting a lookup', async () => {
    const response = await get('', 'sk_live_abcdef123456')

    expect(response.status).toBe(401)
    expect(emailInboxFindFirstMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the inbox is outside the caller organizations', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(emailMessageFindManyMock).not.toHaveBeenCalled()
  })

  it('scopes the inbox lookup by organization', async () => {
    await get()

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1'] } },
    })
  })

  it('returns nextCursor and hasMore=true when more rows exist', async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      message({ id: `msg_${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i) }),
    )
    emailMessageFindManyMock.mockResolvedValue(rows)

    const body = await (await get('?limit=20')).json()

    expect(body.data.hasMore).toBe(true)
    expect(body.data.messages).toHaveLength(20)
    expect(body.data.nextCursor).toBeTruthy()
  })

  it('applies a keyset filter when a cursor is supplied', async () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-01-02T00:00:00.000Z'), id: 'msg_5' })

    await get(`?cursor=${encodeURIComponent(cursor)}`)

    const where = emailMessageFindManyMock.mock.calls[0][0].where
    expect(where.OR[0].createdAt).toHaveProperty('lt')
  })

  it('applies a keyset filter with thread mode (ascending, greater-than)', async () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-01-02T00:00:00.000Z'), id: 'msg_5' })

    await get(`?threadId=thread_1&cursor=${encodeURIComponent(cursor)}`)

    const call = emailMessageFindManyMock.mock.calls[0][0]
    expect(call.where.OR[0].createdAt).toHaveProperty('gt')
    expect(call.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
  })

  it('returns 400 for a malformed cursor', async () => {
    const response = await get('?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(emailMessageFindManyMock).not.toHaveBeenCalled()
  })

  describe('limit clamping', () => {
    async function takeFor(query: string) {
      await get(query)
      return emailMessageFindManyMock.mock.calls[0][0].take
    }

    it('clamps ?limit=100000000 to the max page size', async () => {
      expect(await takeFor('?limit=100000000')).toBe(MAX_LIMIT + 1)
    })

    it('rejects ?limit=-1 rather than passing a negative take to Prisma', async () => {
      expect(await takeFor('?limit=-1')).toBeGreaterThan(0)
    })

    it('rejects ?limit=abc', async () => {
      expect(await takeFor('?limit=abc')).toBeGreaterThan(0)
    })

    it('rejects ?limit=1e9', async () => {
      expect(await takeFor('?limit=1e9')).toBeLessThanOrEqual(MAX_LIMIT + 1)
    })

    it('rejects ?limit=Infinity', async () => {
      expect(await takeFor('?limit=Infinity')).toBeLessThanOrEqual(MAX_LIMIT + 1)
    })

    it('clamps ?limit=0 up to one row', async () => {
      expect(await takeFor('?limit=0')).toBeGreaterThan(1)
    })

    it('honours a valid limit', async () => {
      expect(await takeFor('?limit=5')).toBe(6)
    })
  })

  it('bounds the grouped branch with a clamped take', async () => {
    fetchGroupedThreadHeadsMock.mockResolvedValue([])

    await get('?grouped=true&limit=100000000')

    expect(fetchGroupedThreadHeadsMock.mock.calls[0][2]).toBe(MAX_LIMIT + 1)
  })

  it('uses the grouped query and returns threadCount rows for grouped=true', async () => {
    fetchGroupedThreadHeadsMock.mockResolvedValue([message({ threadCount: 3 })])

    const body = await (await get('?grouped=true')).json()

    expect(fetchGroupedThreadHeadsMock).toHaveBeenCalled()
    expect(emailMessageFindManyMock).not.toHaveBeenCalled()
    expect(body.data.messages[0].threadCount).toBe(3)
  })
})
