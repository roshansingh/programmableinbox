import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const listInboxesMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  listInboxes: (...a: unknown[]) => listInboxesMock(...a),
}))

function keyRequest(url = 'http://localhost:4000/api/v1/emailInbox') {
  return new NextRequest(url, { headers: { authorization: 'Bearer sk_live_abcdef123456' } })
}

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read', 'messages:read'],
}

describe('GET /api/v1/emailInbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('rejects a JWT', async () => {
    const { GET } = await import('../route')
    const request = new NextRequest('http://localhost:4000/api/v1/emailInbox', {
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' },
    })

    expect((await GET(request, { params: Promise.resolve({}) })).status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking inboxes:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['messages:read'] })
    const { GET } = await import('../route')

    const response = await GET(keyRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(403)
    expect(listInboxesMock).not.toHaveBeenCalled()
  })

  it('returns serialized inboxes scoped to the key organization', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listInboxesMock.mockResolvedValue([
      {
        id: 'inbox_1',
        organizationId: 'org_1',
        userId: 'user_1',
        email: 'a@example.com',
        name: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const { GET } = await import('../route')
    const response = await GET(keyRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(listInboxesMock).toHaveBeenCalledWith({ organizationIds: ['org_1'] })
    expect(body.data[0]).not.toHaveProperty('userId')
    expect(body.data[0].email).toBe('a@example.com')
  })

  it('403s when the key requests a different organization', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { GET } = await import('../route')

    const response = await GET(
      keyRequest('http://localhost:4000/api/v1/emailInbox?organizationId=org_other'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(403)
    expect(listInboxesMock).not.toHaveBeenCalled()
  })

  it('401s an unknown or revoked key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(keyRequest(), { params: Promise.resolve({}) })).status).toBe(401)
  })

  it('exports no mutating handlers', async () => {
    const mod = await import('../route')
    expect(mod).not.toHaveProperty('POST')
    expect(mod).not.toHaveProperty('PATCH')
    expect(mod).not.toHaveProperty('DELETE')
  })
})
