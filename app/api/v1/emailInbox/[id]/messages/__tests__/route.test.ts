import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encodeCursor } from '@/lib/pagination/cursor'
import { MAX_LIMIT } from '@/lib/pagination/params'

const resolveApiKeyPrincipalMock = vi.fn()
const listMessagesMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  listMessages: (...a: unknown[]) => listMessagesMock(...a),
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read', 'messages:read'],
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
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
    tags: [],
    extractedOtp: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    externalId: 'resend_abc',
    ...overrides,
  }
}

const params = Promise.resolve({ id: 'inbox_1' })

function request(query = '', authorization = 'Bearer sk_live_abcdef123456') {
  return new NextRequest(
    `http://localhost:4000/api/v1/emailInbox/inbox_1/messages${query}`,
    { headers: { authorization } },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  listMessagesMock.mockResolvedValue({ messages: [], nextCursor: null, hasMore: false })
})

describe('GET /api/v1/emailInbox/[id]/messages', () => {
  it('rejects a JWT without attempting a key lookup', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('', 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), { params })

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking messages:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['inboxes:read'] })
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(403)
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('404s when the inbox is outside the key organization', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(404)
  })

  it('scopes the listing to the organization bound to the key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    await GET(request(), { params })

    expect(listMessagesMock.mock.calls[0][0]).toEqual({ organizationIds: ['org_1'] })
    expect(listMessagesMock.mock.calls[0][1]).toBe('inbox_1')
  })

  it('keeps the messages/nextCursor/hasMore envelope', async () => {
    // The OpenAPI spec and existing consumers depend on these key names.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue({
      messages: [message()],
      nextCursor: 'cursor_abc',
      hasMore: true,
    })
    const { GET } = await import('../route')

    const body = await (await GET(request(), { params })).json()

    expect(Object.keys(body.data).sort()).toEqual(['hasMore', 'messages', 'nextCursor'])
    expect(body.data.hasMore).toBe(true)
    expect(body.data.nextCursor).toBe('cursor_abc')
  })

  it('serializes messages without provider internals', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue({
      messages: [message()],
      nextCursor: null,
      hasMore: false,
    })
    const { GET } = await import('../route')

    const body = await (await GET(request(), { params })).json()

    expect(body.data.messages[0]).not.toHaveProperty('externalId')
  })

  it('clamps an absurd limit before it reaches the service', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    await GET(request('?limit=100000000'), { params })

    expect(listMessagesMock.mock.calls[0][2].limit).toBe(MAX_LIMIT)
  })

  it('400s a malformed cursor without calling the service', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    const response = await GET(request('?cursor=not-a-cursor'), { params })

    expect(response.status).toBe(400)
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('passes a decoded cursor through', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const cursor = encodeCursor({ createdAt: new Date('2026-01-02T00:00:00.000Z'), id: 'msg_5' })
    const { GET } = await import('../route')

    await GET(request(`?cursor=${encodeURIComponent(cursor)}`), { params })

    expect(listMessagesMock.mock.calls[0][2].cursor).toMatchObject({ id: 'msg_5' })
  })

  it('forwards threadId and grouped', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    await GET(request('?threadId=thread_1&grouped=true'), { params })

    expect(listMessagesMock.mock.calls[0][2]).toMatchObject({
      threadId: 'thread_1',
      grouped: true,
    })
  })

  it('preserves threadCount on grouped rows', async () => {
    // The OpenAPI spec documents threadCount on this endpoint as "present only
    // in grouped mode", and the pre-split route returned the raw grouped rows.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue({
      messages: [message({ threadCount: 4 })],
      nextCursor: null,
      hasMore: false,
    })
    const { GET } = await import('../route')

    const body = await (await GET(request('?grouped=true'), { params })).json()

    expect(body.data.messages[0].threadCount).toBe(4)
  })

  it('omits threadCount on a flat listing', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue({
      messages: [message()],
      nextCursor: null,
      hasMore: false,
    })
    const { GET } = await import('../route')

    const body = await (await GET(request(), { params })).json()

    expect(body.data.messages[0]).not.toHaveProperty('threadCount')
  })

  it('exports no mutating handlers', async () => {
    const mod = await import('../route')
    expect(mod).not.toHaveProperty('POST')
    expect(mod).not.toHaveProperty('PATCH')
    expect(mod).not.toHaveProperty('DELETE')
  })
})
