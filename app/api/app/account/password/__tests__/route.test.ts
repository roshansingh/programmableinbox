import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const userFindUniqueMock = vi.fn()
const userUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}))

async function loadRoute() {
  const mod = await import('../route')
  return mod
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/app/account/password', {
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

describe('PATCH /api/app/account/password', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(null)
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'old', newPassword: 'new123' }))
    expect(res.status).toBe(401)
  })

  it('401s an API key, rejected by prefix before any verification', async () => {
    // The route used to carry `if (context.kind !== 'user') return 403`.
    // withUser discriminates on the sk_live_ prefix first, so a key never
    // reaches the handler and the check became unreachable.
    const { PATCH } = await loadRoute()
    const res = await PATCH(keyRequest({ currentPassword: 'old', newPassword: 'new123' }))
    expect(res.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
  })

  it('returns 400 when fields are missing', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'old' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when newPassword is less than 8 chars', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'old', newPassword: 'short' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when newPassword is more than 72 chars', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [] })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'old', newPassword: 'a'.repeat(73) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toBe('New password must be at most 72 characters')
  })

  it('returns 401 when currentPassword is wrong', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [] })
    userFindUniqueMock.mockResolvedValue({ id: 'u1', passwordHash: 'hash' })
    const bcrypt = await import('bcryptjs')
    vi.mocked(bcrypt.default.compare).mockResolvedValue(false as never)
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'wrong', newPassword: 'newpass123' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toBe('Current password is incorrect')
  })

  it('updates password and returns 200 on success', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({ kind: 'user', userId: 'u1', email: 'a@b.com', memberships: [] })
    userFindUniqueMock.mockResolvedValue({ id: 'u1', passwordHash: 'oldhash' })
    const bcrypt = await import('bcryptjs')
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never)
    vi.mocked(bcrypt.default.hash).mockResolvedValue('newhash' as never)
    userUpdateMock.mockResolvedValue({ id: 'u1' })
    const { PATCH } = await loadRoute()
    const res = await PATCH(makeRequest({ currentPassword: 'correct', newPassword: 'newpass123' }))
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'newhash' },
    })
  })
})
