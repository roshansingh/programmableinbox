import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { config } from './config'
import { prisma } from './db'

/**
 * Resolve the JWT signing secret, failing closed if it is missing.
 *
 * Read through the config layer on every call rather than captured at module
 * load: `lib/auth-server` is imported (transitively) by every protected API
 * route, and Next.js evaluates those modules during `next build`, where
 * JWT_SECRET is deliberately absent (see the Dockerfile — the build stage sets
 * no secrets). A module-scope assertion would therefore fail the build instead
 * of the misconfigured deployment.
 *
 * `config.auth` is lazy for that same reason, and memoizes after the first
 * successful parse, so this stays a map lookup rather than a re-validation on
 * every token operation.
 */
function getJwtSecret(): string {
  return config.auth.jwtSecret.reveal()
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signToken(payload: { userId: string }): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
}

export function verifyToken(token: string): { userId: string; issuedAt: number } | null {
  // Resolved outside the try block on purpose: a misconfigured secret must
  // surface as a thrown error (500 + logs), never be swallowed into the `null`
  // path where it is indistinguishable from a merely invalid token.
  const secret = getJwtSecret()

  let payload: unknown
  try {
    payload = jwt.verify(token, secret)
  } catch {
    return null
  }

  if (typeof payload !== 'object' || payload === null) return null

  // Purpose-scoped tokens are never session credentials (issue #102 §6.1).
  // Verification links are signed with EMAIL_LINK_SECRET, so today
  // this is unreachable — the signature check above already fails. It exists
  // so that a future refactor unifying the two secrets cannot silently turn an
  // emailed link into a session token, which is the RFC 8725 §2.8 Cross-JWT
  // Confusion class this codebase removed once already.
  if ('purpose' in payload) return null

  const { userId, iat } = payload as Record<string, unknown>
  if (typeof userId !== 'string' || userId === '') return null

  // `jwt.sign` always stamps `iat`, so a token without one was not minted by
  // signToken. Rejecting rather than defaulting keeps the eviction check below
  // from being bypassable by omitting the claim.
  if (typeof iat !== 'number') return null

  return { userId, issuedAt: iat }
}

export async function resolveUserPrincipalFromToken(token: string): Promise<{
  kind: 'user'
  userId: string
  email: string
  emailVerified: boolean
  memberships: Array<{ organizationId: string; role: string }>
} | null> {
  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      // Selected here rather than fetched by `withUser` separately: the row is
      // already being read, so the verification gate costs no extra round-trip.
      // Populated whether or not ENABLE_EMAIL_VERIFICATION is on — with the
      // flag off it simply never gates anything.
      emailVerified: true,
      passwordChangedAt: true,
      memberships: {
        select: {
          organizationId: true,
          role: true,
        },
      },
    },
  })

  if (!user) return null

  // A completed reset evicts every session that predates it. Someone resetting
  // because their account was compromised expects exactly that; without it the
  // attacker's 7-day JWT outlives the reset meant to stop them.
  //
  // Fails closed at the boundary: `iat` has one-second resolution, so a token
  // minted in the same second as the reset is rejected. That is harmless
  // because the confirm route deliberately issues no session — the user signs
  // in afterwards, which is at minimum a page load away.
  if (user.passwordChangedAt && payload.issuedAt * 1000 < user.passwordChangedAt.getTime()) {
    return null
  }

  return {
    kind: 'user',
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
    })),
  }
}

export async function getAuthenticatedUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      memberships: {
        include: { organization: true },
      },
    },
  })

  return user
}

export function formatUserResponse(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: user.emailVerified,
    organizations: user.memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      createdAt: m.organization.createdAt.toISOString(),
      updatedAt: m.organization.updatedAt.toISOString(),
    })),
  }
}
