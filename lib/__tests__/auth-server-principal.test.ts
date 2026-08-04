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
  emailVerified: true,
  passwordChangedAt: null,
  memberships: [
    { organizationId: 'org_1', role: 'owner' },
    { organizationId: 'org_2', role: 'member' },
  ],
}

// jsonwebtoken is mocked at the module level, so `verify`'s return value never
// goes through the real jwt.verify — these calls stand in for what it hands
// back. `verifyToken` now rejects a payload with no `iat`, so every fixture
// here needs one or it fails before resolveUserPrincipalFromToken's own logic
// runs.
const ISSUED_AT = Math.floor(Date.now() / 1000)

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  // No JWT_SECRET assignment: jsonwebtoken is mocked above, so the secret only
  // needs to be *valid*, which the baseline in vitest.config.ts guarantees.
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
    verifyTokenMock.mockReturnValue({ userId: 'ghost_user', iat: ISSUED_AT })
    userFindUniqueMock.mockResolvedValue(null)

    expect(await resolve('valid.jwt.here')).toBeNull()
  })

  it('normalizes a verified token into a user principal', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user_1', iat: ISSUED_AT })
    userFindUniqueMock.mockResolvedValue(ROW)

    expect(await resolve('valid.jwt.here')).toEqual({
      kind: 'user',
      userId: 'user_1',
      email: 'person@example.com',
      emailVerified: true,
      memberships: [
        { organizationId: 'org_1', role: 'owner' },
        { organizationId: 'org_2', role: 'member' },
      ],
    })
  })

  /**
   * `withUser` reads this to decide the 403 (issue #102 §7.1), so it must be
   * carried faithfully — defaulting a missing value to `true` here would open
   * the gate for every user.
   */
  it('carries an unverified address through to the principal', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user_1', iat: ISSUED_AT })
    userFindUniqueMock.mockResolvedValue({ ...ROW, emailVerified: false })

    expect((await resolve('valid.jwt.here'))?.emailVerified).toBe(false)
  })

  it('selects only the columns the principal needs', async () => {
    // The principal deliberately does not carry passwordHash or the
    // organization relation; widening this select would leak both into every
    // authenticated request's memory.
    verifyTokenMock.mockReturnValue({ userId: 'user_1', iat: ISSUED_AT })
    userFindUniqueMock.mockResolvedValue(ROW)

    await resolve('valid.jwt.here')

    const select = userFindUniqueMock.mock.calls[0][0].select
    expect(select).not.toHaveProperty('passwordHash')
    // emailVerified rides along in the same query rather than costing a second
    // round-trip in withUser (issue #102 §7.1).
    expect(Object.keys(select).sort()).toEqual([
      'email',
      'emailVerified',
      'id',
      'memberships',
      'passwordChangedAt',
    ])
  })

  it('carries an empty membership list through rather than failing', async () => {
    // toOrgScope is what turns "no memberships" into a 403; this function's
    // job is only to say who the caller is.
    verifyTokenMock.mockReturnValue({ userId: 'user_1', iat: ISSUED_AT })
    userFindUniqueMock.mockResolvedValue({ ...ROW, memberships: [] })

    const principal = await resolve('valid.jwt.here')

    expect(principal).not.toBeNull()
    expect(principal!.memberships).toEqual([])
  })
})
