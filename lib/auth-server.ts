import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { prisma } from './db'

/**
 * Denylist entry, NOT a default. This is the value this module used to fall back
 * to when JWT_SECRET was unset; it is published in this repository's git history,
 * so it is equivalent to having no secret at all — anyone can mint a token for any
 * userId. It is kept here only so a deployment that copied it into its real
 * environment fails loudly instead of running forgeable sessions.
 */
const PUBLICLY_KNOWN_DEV_SECRET = 'dev-secret-change-in-production'

const MISSING_SECRET_MESSAGE =
  'JWT_SECRET is not configured. Set it to a strong random value ' +
  '(e.g. `openssl rand -base64 32`) — refusing to sign or verify tokens.'

/**
 * Resolve the JWT signing secret, failing closed if it is missing or known-weak.
 *
 * Read lazily on every call rather than captured at module load: `lib/auth-server`
 * is imported (transitively) by every protected API route, and Next.js evaluates
 * those modules during `next build`, where JWT_SECRET is deliberately absent (see
 * the Dockerfile — the build stage sets no secrets). A module-scope assertion
 * would therefore fail the build instead of the misconfigured deployment. Reading
 * per call keeps the failure at request time, where it is loud, isolated to the
 * request, and also lets a rotated secret take effect without a code reload.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET

  if (!secret || secret.trim() === '') {
    throw new Error(MISSING_SECRET_MESSAGE)
  }

  if (secret === PUBLICLY_KNOWN_DEV_SECRET) {
    throw new Error(
      'JWT_SECRET is set to the removed development placeholder, which is public. ' +
        'Generate a new secret (e.g. `openssl rand -base64 32`); all existing sessions ' +
        'signed with the placeholder must be considered forged.',
    )
  }

  return secret
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

export function verifyToken(token: string): { userId: string } | null {
  // Resolved outside the try block on purpose: a misconfigured secret must
  // surface as a thrown error (500 + logs), never be swallowed into the `null`
  // path where it is indistinguishable from a merely invalid token.
  const secret = getJwtSecret()

  try {
    return jwt.verify(token, secret) as { userId: string }
  } catch {
    return null
  }
}

export async function resolveUserPrincipalFromToken(token: string): Promise<{
  kind: 'user'
  userId: string
  email: string
  memberships: Array<{ organizationId: string; role: string }>
} | null> {
  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      memberships: {
        select: {
          organizationId: true,
          role: true,
        },
      },
    },
  })

  if (!user) return null

  return {
    kind: 'user',
    userId: user.id,
    email: user.email,
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
