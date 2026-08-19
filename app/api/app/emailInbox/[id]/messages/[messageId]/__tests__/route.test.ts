/**
 * Ported from the v1 suite when these routes moved to /api/app.
 *
 * The split shows up most sharply here: GET is organization-scoped (a colleague
 * can read the message) while PATCH and DELETE are creator-only, so the two
 * resolve ownership through different lookups on purpose.
 *
 * The original file had no DELETE coverage at all — that is why retiring the
 * messages:delete scope in Task 4 broke nothing visible. It is covered now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailMessageFindFirstMock = vi.fn()
const emailMessageUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: (...a: unknown[]) => emailInboxFindFirstMock(...a), findMany: vi.fn() },
    emailMessage: {
      findFirst: (...a: unknown[]) => emailMessageFindFirstMock(...a),
      update: (...a: unknown[]) => emailMessageUpdateMock(...a),
      findMany: vi.fn(),
    },
  },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'
const INBOX = { id: 'inbox_1', organizationId: 'org_1', userId: 'user_1' }

const MESSAGE = {
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
}

const params = Promise.resolve({ id: 'inbox_1', messageId: 'msg_1' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(INBOX)
  emailMessageFindFirstMock.mockResolvedValue(MESSAGE)
})

function request(method: string, body?: unknown, authorization = TOKEN) {
  return new NextRequest('http://localhost/api/app/emailInbox/inbox_1/messages/msg_1', {
    method,
    headers: authorization ? { authorization } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('GET /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('returns the message', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('GET'), { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.id).toBe('msg_1')
  })

  it('returns 401 without authentication', async () => {
    const { GET } = await import('../route')

    expect((await GET(request('GET', undefined, ''), { params })).status).toBe(401)
  })

  it('rejects an API key without attempting a lookup', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('GET', undefined, 'Bearer sk_live_abcdef123456'), { params })

    expect(response.status).toBe(401)
    expect(emailInboxFindFirstMock).not.toHaveBeenCalled()
  })

  it('reads organization-wide, so a colleague can open the message', async () => {
    const { GET } = await import('../route')

    await GET(request('GET'), { params })

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1'] } },
    })
  })

  it('404s when the inbox is outside the caller organizations', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request('GET'), { params })

    expect(response.status).toBe(404)
    expect(emailMessageFindFirstMock).not.toHaveBeenCalled()
  })

  it('404s a message that belongs to a different inbox', async () => {
    emailMessageFindFirstMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request('GET'), { params })).status).toBe(404)
  })

  it('does not expose provider internals in the app payload', async () => {
    const { GET } = await import('../route')

    const body = await (await GET(request('GET'), { params })).json()

    expect(body.data).not.toHaveProperty('externalId')
    expect(body.data).not.toHaveProperty('headers')
  })
})

describe('PATCH /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('stars the message for its creator', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isStarred: true })
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isStarred: true }), { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.isStarred).toBe(true)
  })

  it('resolves ownership with a userId-constrained lookup, not the read scope', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isStarred: true })
    const { PATCH } = await import('../route')

    await PATCH(request('PATCH', { isStarred: true }), { params })

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', userId: 'user_1' },
    })
  })

  it('404s a colleague who can read the message but does not own the inbox', async () => {
    // Reads widened to the organization; mutation authority did not.
    emailInboxFindFirstMock.mockResolvedValue(null)
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isStarred: true }), { params })

    expect(response.status).toBe(404)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('400s a non-boolean isStarred', async () => {
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isStarred: 'yes' }), { params })

    expect(response.status).toBe(400)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects an API key', async () => {
    const { PATCH } = await import('../route')

    const response = await PATCH(
      request('PATCH', { isStarred: true }, 'Bearer sk_live_abcdef123456'),
      { params },
    )

    expect(response.status).toBe(401)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('400s when neither isStarred nor isRead is provided', async () => {
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', {}), { params })

    expect(response.status).toBe(400)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/app/emailInbox/[id]/messages/[messageId] — isRead (issue #138)', () => {
  it('marks the message read', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: true })
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: true }), { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.isRead).toBe(true)
  })

  it('resolves via the organization scope, not owner-only, unlike isStarred', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: true })
    const { PATCH } = await import('../route')

    await PATCH(request('PATCH', { isRead: true }), { params })

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1'] } },
    })
  })

  it('lets a colleague who does not own the inbox mark it read', async () => {
    // INBOX.userId is 'user_1'; this caller is a different member of the same
    // organization. isStarred's owner-only lookup would 404 this caller.
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ ...PRINCIPAL, userId: 'user_2' })
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: true })
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: true }), { params })

    expect(response.status).toBe(200)
  })

  it('403s a user who belongs to no organization', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ ...PRINCIPAL, memberships: [] })
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: true }), { params })

    expect(response.status).toBe(403)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('404s when the inbox is outside the caller organizations', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: true }), { params })

    expect(response.status).toBe(404)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('404s a message that belongs to a different inbox', async () => {
    emailMessageFindFirstMock.mockResolvedValue(null)
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: true }), { params })

    expect(response.status).toBe(404)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('400s a non-boolean isRead', async () => {
    const { PATCH } = await import('../route')

    const response = await PATCH(request('PATCH', { isRead: 'yes' }), { params })

    expect(response.status).toBe(400)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects an API key', async () => {
    const { PATCH } = await import('../route')

    const response = await PATCH(
      request('PATCH', { isRead: true }, 'Bearer sk_live_abcdef123456'),
      { params },
    )

    expect(response.status).toBe(401)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('soft-deletes the message for its creator', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, deletedAt: new Date() })
    const { DELETE } = await import('../route')

    const response = await DELETE(request('DELETE'), { params })

    expect(response.status).toBe(204)
    expect(emailMessageUpdateMock).toHaveBeenCalledWith({
      where: { id: 'msg_1' },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('404s a colleague who does not own the inbox', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)
    const { DELETE } = await import('../route')

    const response = await DELETE(request('DELETE'), { params })

    expect(response.status).toBe(404)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('404s a message that belongs to a different inbox', async () => {
    emailMessageFindFirstMock.mockResolvedValue(null)
    const { DELETE } = await import('../route')

    const response = await DELETE(request('DELETE'), { params })

    expect(response.status).toBe(404)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects an API key — deletion is dashboard-only after the split', async () => {
    const { DELETE } = await import('../route')

    const response = await DELETE(request('DELETE', undefined, 'Bearer sk_live_abcdef123456'), {
      params,
    })

    expect(response.status).toBe(401)
    expect(emailMessageUpdateMock).not.toHaveBeenCalled()
  })
})
