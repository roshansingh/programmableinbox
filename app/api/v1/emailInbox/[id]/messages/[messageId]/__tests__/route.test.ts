/**
 * Rewritten for the read-only external surface.
 *
 * The previous version asserted on `messages:delete` — a scope that gated a
 * destructive operation and was granted to every key by default. Both the
 * scope and the DELETE handler are gone; what remains is a GET, and the
 * assertion that nothing mutating can be reached here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const getMessageMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  getMessage: (...a: unknown[]) => getMessageMock(...a),
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read', 'messages:read'],
}

const MESSAGE = {
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
  extractedOtp: '123456',
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
  externalId: 'resend_abc',
  headers: { 'x-provider': 'resend' },
}

const params = Promise.resolve({ id: 'inbox_1', messageId: 'msg_1' })

function request(authorization = 'Bearer sk_live_abcdef123456') {
  return new NextRequest(
    'http://localhost:4000/api/v1/emailInbox/inbox_1/messages/msg_1',
    { headers: { authorization } },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
})

describe('GET /api/v1/emailInbox/[id]/messages/[messageId]', () => {
  it('rejects a JWT without attempting a key lookup', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), { params })

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking messages:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['inboxes:read'] })
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(403)
    expect(getMessageMock).not.toHaveBeenCalled()
  })

  it('404s a message in another organization', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getMessageMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(404)
  })

  it('404s a message that does not belong to the inbox', async () => {
    // getMessage constrains the message to the inbox, so this is the same null.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getMessageMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(404)
    expect((await response.json()).message).toBe('Message not found')
  })

  it('returns the public shape without provider internals', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getMessageMock.mockResolvedValue(MESSAGE)
    const { GET } = await import('../route')

    const body = await (await GET(request(), { params })).json()

    expect(body.data.id).toBe('msg_1')
    expect(body.data).not.toHaveProperty('externalId')
    expect(body.data).not.toHaveProperty('headers')
    // Published deliberately: derived from a body the same scope returns.
    expect(body.data.extractedOtp).toBe('123456')
  })

  it('exports no PATCH — starring is dashboard state, and it was gated by messages:read', async () => {
    const mod = await import('../route')
    expect(mod).not.toHaveProperty('PATCH')
  })

  it('exports no DELETE — it was reachable by any organization key', async () => {
    const mod = await import('../route')
    expect(mod).not.toHaveProperty('DELETE')
  })
})
