import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import { RESEND_COOLDOWN_SECONDS } from '@/lib/auth/verification-token'
import { sendVerificationEmail } from '@/lib/email/verification-email'
import logger from '@/lib/logger'

/**
 * Re-sends the verification link to the caller's *own* address (issue #102
 * §7.4).
 *
 * The address is taken from the principal and never from the request body, so
 * this endpoint cannot be aimed at a third party — it is a mail-sending
 * primitive available to anyone with a session, and the only thing keeping it
 * from being a spam relay is that it has exactly one possible recipient.
 *
 * `allowUnverified` because an unverified user is the only one who ever needs
 * it; without the opt-out the gate would 403 the one call that could clear it.
 */
export const POST = withUser({ allowUnverified: true }, async (_request: NextRequest, principal) => {
  if (!config.emailVerification.enabled) {
    return jsonError('Not found', 404)
  }

  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { id: true, email: true, emailVerified: true, verificationEmailSentAt: true },
  })

  if (!user) return jsonError('Unauthorized', 401)

  // Not an error: there is simply nothing to send. `sent: false` lets the UI
  // say so and move on rather than rendering a failure for a user whose
  // address is already proven — the common case being a second tab.
  if (user.emailVerified) {
    return jsonSuccess({ sent: false })
  }

  // Compared against a stored timestamp rather than an in-process map: the app
  // runs as more than one container, so an in-memory throttle is defeated by
  // round-robin across instances and resets on every deploy.
  const lastSent = user.verificationEmailSentAt
  if (lastSent) {
    const elapsedSeconds = (Date.now() - lastSent.getTime()) / 1000
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      return jsonError('Please wait before requesting another email', 429)
    }
  }

  try {
    await sendVerificationEmail({ id: user.id, email: user.email })
  } catch (error) {
    // The timestamp is stamped only after a successful send, on purpose: a
    // failed send must not start a cooldown, or a transient Resend outage
    // locks the user out of retrying for a minute for no reason.
    logger.error({ error, userId: user.id }, 'Failed to resend verification email')
    return jsonError('Could not send the verification email. Please try again.', 502)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { verificationEmailSentAt: new Date() },
  })

  return jsonSuccess({ sent: true })
})
