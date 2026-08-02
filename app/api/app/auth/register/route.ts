import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, signToken, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import { defaultOrganizationName } from '@/lib/user-display'
import { config } from '@/lib/config'
import { sendVerificationEmail } from '@/lib/email/verification-email'
import logger from '@/lib/logger'

/**
 * Unauthenticated by design: a caller has no credential yet. withPublic
 * carries no behavior — it marks the intent so the structural guards can tell
 * "deliberately open" apart from "someone forgot the wrapper".
 */
export const POST = withPublic(async (request: NextRequest) => {
  try {
    const { email, password, firstName, lastName } = await request.json()

    if (!email || !password) {
      return jsonError('Email and password are required', 400)
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

    if (config.emailVerification.enabled) {
      // A send failure must NOT fail the signup (issue #102 §7.2). The account
      // and organization are already committed, so a 500 here would leave the
      // user holding an account they believe does not exist and an email they
      // cannot re-request. The gate screen's Resend button is the recovery
      // path; this is logged at error so the operator sees it regardless.
      try {
        await sendVerificationEmail({ id: user.id, email: user.email })
        await prisma.user.update({
          where: { id: user.id },
          data: { verificationEmailSentAt: new Date() },
        })
      } catch (error) {
        logger.error(
          { error, userId: user.id },
          'Failed to send signup verification email',
        )
      }
    }

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
