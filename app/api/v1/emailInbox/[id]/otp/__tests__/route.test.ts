/**
 * Moved from /api/app/emailInbox/[id]/otp — this was never a dashboard route;
 * it exists for API-key-holding automation to read a code back after
 * provisioning a throwaway inbox. Shares its lookup (findLatestOtp) and
 * response shape (otp + the message it came from) with the MCP tool
 * pibx_email_get_latest_otp — lib/mcp/__tests__/tools.test.ts covers that
 * side, lib/services/__tests__/email-inbox.test.ts covers the shared lookup
 * logic itself, so this file only covers request parsing and wiring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const findLatestOtpMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  findLatestOtp: (...a: unknown[]) => findLatestOtpMock(...a),
  OTP_DEFAULT_WINDOW_MINUTES: 15,
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['email_inboxes:read', 'email_messages:read'],
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    threadId: 'thread_1',
    parentMessageId: null,
    subject: 'Your code',
    from: 'noreply@example.com',
    to: ['a@example.com'],
    cc: [],
    bcc: [],
    text: 'Your code is 123456',
    html: '<p>Your code is 123456</p>',
    bodyText: 'Your code is 123456',
    isStarred: false,
    isRead: false,
    tags: [],
    categories: [],
    extractedOtp: '123456',
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  }
}

const params = Promise.resolve({ id: 'inbox_1' })

function request(query = '', authorization = 'Bearer sk_live_abcdef123456') {
  return new NextRequest(`http://localhost:4000/api/v1/emailInbox/inbox_1/otp${query}`, {
    headers: { authorization },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
})

describe('GET /api/v1/emailInbox/[id]/otp', () => {
  it('rejects a JWT without attempting a key lookup', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('', 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), { params })

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking email_messages:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['email_inboxes:read'] })
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(403)
    expect(findLatestOtpMock).not.toHaveBeenCalled()
  })

  it('404s when the inbox is not visible to the key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(404)
  })

  it('404s, distinguishing staleness, when no matching OTP is found', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    findLatestOtpMock.mockResolvedValue({ found: false, stale: true })
    const stale = await GET(request(), { params })
    expect(stale.status).toBe(404)
    expect((await stale.json()).message).toContain('older than 15 minutes')

    findLatestOtpMock.mockResolvedValue({ found: false, stale: false })
    const none = await GET(request(), { params })
    expect(none.status).toBe(404)
    expect((await none.json()).message).not.toContain('older than')
  })

  it('returns otp and the message it came from when found', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue({ found: true, message: message() })
    const { GET } = await import('../route')

    const response = await GET(request(), { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.otp).toBe('123456')
    expect(body.data.message.id).toBe('msg_1')
    expect(body.data.message.from).toBe('noreply@example.com')
    expect(body.data.message.subject).toBe('Your code')
    expect(new Date(body.data.message.createdAt)).toEqual(message().createdAt)
  })

  it('401s an unknown or revoked key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(401)
  })

  it('scopes the lookup to the organization bound to the key, with the default window', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue({ found: true, message: message() })
    const { GET } = await import('../route')

    await GET(request(), { params })

    expect(findLatestOtpMock).toHaveBeenCalledWith(
      { organizationIds: ['org_1'] },
      'inbox_1',
      { search: null, windowMinutes: 15 },
    )
  })

  it('passes withinMinutes through when provided', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue({ found: true, message: message() })
    const { GET } = await import('../route')

    await GET(request('?withinMinutes=60'), { params })

    expect(findLatestOtpMock.mock.calls[0][2].windowMinutes).toBe(60)
  })

  it('400s a non-integer withinMinutes rather than silently defaulting', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    const response = await GET(request('?withinMinutes=abc'), { params })

    expect(response.status).toBe(400)
    expect(findLatestOtpMock).not.toHaveBeenCalled()
  })

  it('400s a withinMinutes outside 1..1440', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    expect((await GET(request('?withinMinutes=0'), { params })).status).toBe(400)
    expect((await GET(request('?withinMinutes=1441'), { params })).status).toBe(400)
    expect(findLatestOtpMock).not.toHaveBeenCalled()
  })

  it('builds a from search through the shared parser', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue({ found: true, message: message() })
    const { GET } = await import('../route')

    await GET(request('?from=stripe.com'), { params })

    expect(findLatestOtpMock.mock.calls[0][2].search).toEqual({
      q: null,
      from: 'stripe.com',
      tags: [],
      categories: [],
    })
  })

  it('does not search when no from filter was given', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    findLatestOtpMock.mockResolvedValue({ found: true, message: message() })
    const { GET } = await import('../route')

    await GET(request(), { params })

    expect(findLatestOtpMock.mock.calls[0][2].search).toBeNull()
  })
})
