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
