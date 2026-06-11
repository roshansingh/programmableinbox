import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveAuthContextMock = vi.fn()
const orgUpdateMock = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: (...args: unknown[]) => resolveAuthContextMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    organization: {
      update: (...args: unknown[]) => orgUpdateMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/v1/account/organization', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/v1/account/organization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    resolveAuthContextMock.mockResolvedValue(null)
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when called with API key context', async () => {
    resolveAuthContextMock.mockResolvedValue({ kind: 'apiKey', apiKeyId: 'k1', organizationId: 'o1', scopes: [] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    resolveAuthContextMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1' }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when user is not a member of the org', async () => {
    resolveAuthContextMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'other-org', role: 'owner' }] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }))
    expect(res.status).toBe(403)
  })

  it('updates org name and returns updated org on success', async () => {
    resolveAuthContextMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    orgUpdateMock.mockResolvedValue({ id: 'o1', name: 'New Name', slug: 'my-org' })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('New Name')
    expect(orgUpdateMock).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { name: 'New Name' },
    })
  })
})
