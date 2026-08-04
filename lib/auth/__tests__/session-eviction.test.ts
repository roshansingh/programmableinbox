import { beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { withConfigEnv } from '@/test/config'

const findUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}))

const SESSION_SECRET = 'test-jwt-secret-at-least-16-chars'

function userRow(passwordChangedAt: Date | null) {
  return {
    id: 'user_1',
    email: 'user@example.com',
    emailVerified: true,
    passwordChangedAt,
    memberships: [],
  }
}

describe('session eviction on password change', () => {
  withConfigEnv({ JWT_SECRET: SESSION_SECRET })

  beforeEach(() => {
    findUniqueMock.mockReset()
  })

  it('accepts a session issued after the password changed', async () => {
    const { signToken, resolveUserPrincipalFromToken } = await import('../../auth-server')
    findUniqueMock.mockResolvedValue(userRow(new Date(Date.now() - 60_000)))

    const principal = await resolveUserPrincipalFromToken(signToken({ userId: 'user_1' }))

    expect(principal).toMatchObject({ kind: 'user', userId: 'user_1' })
  })

  it('rejects a session issued before the password changed', async () => {
    const { resolveUserPrincipalFromToken } = await import('../../auth-server')

    const issuedAt = Math.floor(Date.now() / 1000) - 3600
    const stale = jwt.sign({ userId: 'user_1', iat: issuedAt }, SESSION_SECRET, {
      expiresIn: '7d',
    })
    findUniqueMock.mockResolvedValue(userRow(new Date()))

    expect(await resolveUserPrincipalFromToken(stale)).toBeNull()
  })

  it('accepts any session when the password has never been changed', async () => {
    const { signToken, resolveUserPrincipalFromToken } = await import('../../auth-server')
    findUniqueMock.mockResolvedValue(userRow(null))

    expect(await resolveUserPrincipalFromToken(signToken({ userId: 'user_1' }))).not.toBeNull()
  })
})
