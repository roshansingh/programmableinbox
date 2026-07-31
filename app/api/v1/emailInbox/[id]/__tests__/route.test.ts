import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const getInboxMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  getInbox: (...a: unknown[]) => getInboxMock(...a),
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read', 'messages:read'],
}

const ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'a@example.com',
  name: 'Support',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const params = Promise.resolve({ id: 'inbox_1' })

function request(authorization = 'Bearer sk_live_abcdef123456') {
  return new NextRequest('http://localhost:4000/api/v1/emailInbox/inbox_1', {
    headers: { authorization },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
})

describe('GET /api/v1/emailInbox/[id]', () => {
  it('rejects a JWT without attempting a key lookup', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), { params })

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a key lacking inboxes:read', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['messages:read'] })
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(403)
    expect(getInboxMock).not.toHaveBeenCalled()
  })

  it('404s an inbox in another organization', async () => {
    // getInbox constrains by organization in the query, so a foreign inbox is
    // indistinguishable from one that does not exist.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    expect((await GET(request(), { params })).status).toBe(404)
  })

  it('scopes the lookup to the organization bound to the key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue(ROW)
    const { GET } = await import('../route')

    await GET(request(), { params })

    expect(getInboxMock).toHaveBeenCalledWith({ organizationIds: ['org_1'] }, 'inbox_1')
  })

  it('returns the public shape without the creating user', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    getInboxMock.mockResolvedValue(ROW)
    const { GET } = await import('../route')

    const body = await (await GET(request(), { params })).json()

    expect(body.data.email).toBe('a@example.com')
    expect(body.data).not.toHaveProperty('userId')
    expect(body.data).not.toHaveProperty('deletedAt')
  })

  it('exports no mutating handlers', async () => {
    const mod = await import('../route')
    expect(mod).not.toHaveProperty('PATCH')
    expect(mod).not.toHaveProperty('DELETE')
    expect(mod).not.toHaveProperty('POST')
  })
})
