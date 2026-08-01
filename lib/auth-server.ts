import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { prisma } from './db'
import { config } from './config'

/**
 * Resolve the JWT signing secret from the validated config, failing closed if
 * it is missing or invalid. The config accessor is lazy and memoized, so this
 * is safe to call at request time even though the module is imported at build
 * time (see CLAUDE.md — no module-scope assertions).
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
