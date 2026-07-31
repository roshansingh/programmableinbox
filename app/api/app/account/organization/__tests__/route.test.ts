import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const orgUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
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
  return new NextRequest('http://localhost/api/app/account/organization', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

function keyRequest(body: object) {
  const request = makeRequest(body)
  request.headers.set('Authorization', 'Bearer sk_live_abcdef123456')
  return request
}

describe('PATCH /api/app/account/organization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(null)
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  it('401s an API key, rejected by prefix before any verification', async () => {
    // The route used to carry `if (context.kind !== 'user') return 403`.
    // withUser discriminates on the sk_live_ prefix first, so a key never
    // reaches the handler and the check became unreachable.
    const { PATCH } = await loadRoute()
    const res = await PATCH(keyRequest({ organizationId: 'o1', name: 'New Name' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
  })

  it('returns 400 when name is missing', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is whitespace-only', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: '   ' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('trims whitespace from name before saving', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    orgUpdateMock.mockResolvedValue({ id: 'o1', name: 'New Name', slug: 'my-org' })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: '  New Name  ' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(orgUpdateMock).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { name: 'New Name' },
    })
  })

  it('returns 403 when user is not a member of the org', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'other-org', role: 'owner' }] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
  })

  it('updates org name and returns updated org on success', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [{ organizationId: 'o1', role: 'owner' }] })
    orgUpdateMock.mockResolvedValue({ id: 'o1', name: 'New Name', slug: 'my-org' })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ organizationId: 'o1', name: 'New Name' }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('New Name')
    expect(orgUpdateMock).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { name: 'New Name' },
    })
  })
})
