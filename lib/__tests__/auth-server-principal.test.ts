/**
 * Direct coverage for resolveUserPrincipalFromToken.
 *
 * Written while deleting lib/auth/__tests__/auth-context.test.ts, which named
 * this function but mocked it — so it asserted resolveAuthContext's dispatch,
 * never the verification itself. Every withUser route now depends on this
 * function, and nothing exercised it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyTokenMock = vi.fn()
const userFindUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUniqueMock(...a) },
  },
}))

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    verify: (...a: unknown[]) => verifyTokenMock(...a),
  },
}))

const ROW = {
  id: 'user_1',
  email: 'person@example.com',
  memberships: [
    { organizationId: 'org_1', role: 'owner' },
    { organizationId: 'org_2', role: 'member' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  process.env.JWT_SECRET = 'test-secret-not-for-production'
})

async function resolve(token: string) {
  const { resolveUserPrincipalFromToken } = await import('@/lib/auth-server')
  return resolveUserPrincipalFromToken(token)
}

describe('resolveUserPrincipalFromToken', () => {
  it('returns null for a token that fails verification, without touching the database', async () => {
    verifyTokenMock.mockImplementation(() => {
      throw new Error('invalid signature')
    })

    expect(await resolve('tampered.jwt.here')).toBeNull()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null when the token is valid but the user no longer exists', async () => {
    // A session outliving its user must not authenticate. The token verifies,
    // so only this lookup stands between a deleted account and a live session.
    verifyTokenMock.mockReturnValue({ userId: 'ghost_user' })
    userFindUniqueMock.mockResolvedValue(null)

    expect(await resolve('valid.jwt.here')).toBeNull()
  })

  it('normalizes a verified token into a user principal', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user_1' })
    userFindUniqueMock.mockResolvedValue(ROW)

    expect(await resolve('valid.jwt.here')).toEqual({
      kind: 'user',
      userId: 'user_1',
      email: 'person@example.com',
      memberships: [
        { organizationId: 'org_1', role: 'owner' },
        { organizationId: 'org_2', role: 'member' },
      ],
    })
  })

  it('selects only the columns the principal needs', async () => {
    // The principal deliberately does not carry passwordHash or the
    // organization relation; widening this select would leak both into every
    // authenticated request's memory.
    verifyTokenMock.mockReturnValue({ userId: 'user_1' })
    userFindUniqueMock.mockResolvedValue(ROW)

    await resolve('valid.jwt.here')

    const select = userFindUniqueMock.mock.calls[0][0].select
    expect(select).not.toHaveProperty('passwordHash')
    expect(Object.keys(select).sort()).toEqual(['email', 'id', 'memberships'])
  })

  it('carries an empty membership list through rather than failing', async () => {
    // toOrgScope is what turns "no memberships" into a 403; this function's
    // job is only to say who the caller is.
    verifyTokenMock.mockReturnValue({ userId: 'user_1' })
    userFindUniqueMock.mockResolvedValue({ ...ROW, memberships: [] })

    const principal = await resolve('valid.jwt.here')

    expect(principal).not.toBeNull()
    expect(principal!.memberships).toEqual([])
  })
})
