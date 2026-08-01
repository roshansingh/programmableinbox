import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, signToken, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import { defaultOrganizationName } from '@/lib/user-display'
import {
  accountBucket,
  consumeClientIpRateLimit,
  consumeRateLimit,
  getClientIp,
  getRateLimitConfig,
  rateLimitHeaders,
} from '@/lib/security/rate-limit'
import logger from '@/lib/logger'

/** Shared message for every throttled registration outcome. */
const THROTTLED = 'Too many registration attempts. Please try again later.'

/**
 * Unauthenticated by design: a caller has no credential yet. withPublic
 * carries no behavior — it marks the intent so the structural guards can tell
 * "deliberately open" apart from "someone forgot the wrapper".
 *
 * Unlike login, both limits reject up front. There is no credential to verify
 * that could distinguish a legitimate caller from an abusive one, and being
 * unable to register an address for an hour is a far smaller harm than being
 * unable to log into an account you already own.
 */
export const POST = withPublic(async (request: NextRequest) => {
  try {
    const { email, password, firstName, lastName } = await request.json()

    // Type-check every field, not just presence. `hashPassword` hands the value
    // to bcrypt, which throws on a non-string — that surfaced as a 500 on input
    // a client controls, when it is plainly a 400. Same for the name fields,
    // which Prisma would otherwise reject at insert time with the same outcome.
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return jsonError('Email and password are required', 400)
    }
    if (
      (firstName !== undefined && firstName !== null && typeof firstName !== 'string') ||
      (lastName !== undefined && lastName !== null && typeof lastName !== 'string')
    ) {
      return jsonError('firstName and lastName must be strings', 400)
    }

    const config = getRateLimitConfig()
    const client = getClientIp(request)

    // Unthrottled registration lets a script mint accounts (and the
    // organization + membership rows each one creates) without bound.
    const ipDecision = await consumeClientIpRateLimit('register:ip', client, config.register.ip)
    if (ipDecision && !ipDecision.allowed) {
      logger.warn(
        { ip: client.ip, scope: ipDecision.scope, degraded: ipDecision.degraded },
        'Registration rate limit exceeded for IP',
      )
      return jsonError(THROTTLED, 429, rateLimitHeaders(ipDecision))
    }

    // Also cap attempts per submitted address so a single target cannot be
    // hammered from many sources.
    const accountDecision = await consumeRateLimit(
      'register:account',
      accountBucket(email),
      config.register.account,
    )
    if (!accountDecision.allowed) {
      logger.warn(
        { ip: client.ip, scope: accountDecision.scope, degraded: accountDecision.degraded },
        'Registration rate limit exceeded for email',
      )
      return jsonError(THROTTLED, 429, rateLimitHeaders(accountDecision))
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return jsonError('User with this email already exists', 409)
    }

    const passwordHash = await hashPassword(password)
    const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: firstName || null,
          lastName: lastName || null,
        },
      })

      const org = await tx.organization.create({
        data: {
          name: defaultOrganizationName(firstName, lastName, email),
          slug: `${slug}-${Date.now()}`,
        },
      })

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organizationId: org.id,
          role: 'owner',
        },
      })

      return await tx.user.findUniqueOrThrow({
        where: { id: newUser.id },
        include: {
          memberships: {
            include: { organization: true },
          },
        },
      })
    })

    const token = signToken({ userId: user.id })

    return jsonSuccess({
      token,
      user: formatUserResponse(user),
    })
  } catch (error) {
    logger.error({ error }, 'Error registering user')
    return jsonError('Internal server error', 500)
  }
})
