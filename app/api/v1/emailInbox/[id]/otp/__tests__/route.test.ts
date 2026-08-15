/**
 * Moved from /api/app/emailInbox/[id]/otp — this was never a dashboard route;
 * it exists for API-key-holding automation to read a code back after
 * provisioning a throwaway inbox, mirroring the MCP tool
 * pibx_email_get_latest_otp.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const getInboxMock = vi.fn()
const emailMessageFindFirstMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  getInbox: (...a: unknown[]) => getInboxMock(...a),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findFirst: (...a: unknown[]) => emailMessageFindFirstMock(...a) },
  },
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['email_inboxes:read', 'email_messages:read'],
}

const params = Promise.resolve({ id: 'inbox_1' })

function request(authorization = 'Bearer sk_live_abcdef123456') {
  return new NextRequest('http://localhost:4000/api/v1/emailInbox/inbox_1/otp', {
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

    const response = await GET(request('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), { params })

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking email_messages:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['email_inboxes:read'] })
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(403)
    expect(getInboxMock).not.toHaveBeenCalled()
  })

  it('scopes the inbox lookup to the organization bound to the key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    await GET(request(), { params })

    expect(getInboxMock).toHaveBeenCalledWith({ organizationIds: ['org_1'] }, 'inbox_1')
  })

  it('404s when the inbox is not visible to the key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(404)
    expect(emailMessageFindFirstMock).not.toHaveBeenCalled()
  })

  it('404s when no OTP has been extracted for the inbox', async () => {
    getInboxMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    emailMessageFindFirstMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request(), { params })

    expect(response.status).toBe(404)
    expect((await response.json()).message).toBe('No OTP found for this inbox')
  })

  it('returns otp, receivedAt, messageId, from when found', async () => {
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    emailMessageFindFirstMock.mockResolvedValue({
      extractedOtp: '123456',
      createdAt,
      id: 'msg_1',
      from: 'noreply@example.com',
    })
    const { GET } = await import('../route')

    const response = await GET(request(), { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.otp).toBe('123456')
    expect(body.data.messageId).toBe('msg_1')
    expect(body.data.from).toBe('noreply@example.com')
    expect(new Date(body.data.receivedAt)).toEqual(createdAt)
  })

  it('401s an unknown or revoked key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(401)
  })
})
