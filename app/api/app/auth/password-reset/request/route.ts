import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import { sendPasswordResetEmail } from '@/lib/email/password-reset-email'
import logger from '@/lib/logger'

/** Minimum gap between reset sends for one account. */
const RESET_COOLDOWN_SECONDS = 60

/**
 * Starts a password reset.
 *
 * **Every outcome returns the same 200 and the same body.** A nonexistent
 * account, a cooldown block, a malformed body and a Resend failure are
 * indistinguishable to the caller. This endpoint takes an arbitrary
 * third-party address in the request body, so any outcome-dependent response —
 * including an honest 429 — would turn it into an account-existence oracle.
 * Failures are logged; the caller learns nothing.
 *
 * Known gap: the *body* is uniform, the *timing* is not. A real account waits
 * on a Resend round-trip that a nonexistent one skips. Closing that needs the
 * send moved off the request path, which is more machinery than this flow
 * currently justifies. Recorded here so the next reader knows it was weighed
 * rather than missed.
 */
export const POST = withPublic(async (request: NextRequest) => {
  // 404 rather than 400: with the flag off this is not a misused endpoint, it
  // is a feature the deployment does not have.
  if (!config.emailVerification.enabled) {
    return jsonError('Not found', 404)
  }

  let email: unknown
  try {
    ;({ email } = await request.json())
  } catch {
    return jsonSuccess({ requested: true })
  }

  if (typeof email !== 'string' || email.trim() === '') {
    return jsonSuccess({ requested: true })
  }

  // Addresses are stored lowercased; a user typing their address with different
  // capitalisation than they signed up with must still get a link.
  const normalized = email.trim().toLowerCase()

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordResetEmailSentAt: true,
    },
  })

  if (!user) {
    logger.info({ email: normalized }, 'Password reset requested for an unknown address')
    return jsonSuccess({ requested: true })
  }

  // Compared against a stored timestamp rather than an in-process map: the app
  // runs as more than one container, so an in-memory throttle is defeated by
  // round-robin across instances and resets on every deploy.
  const lastSent = user.passwordResetEmailSentAt
  if (lastSent && (Date.now() - lastSent.getTime()) / 1000 < RESET_COOLDOWN_SECONDS) {
    logger.info({ userId: user.id }, 'Password reset suppressed by the cooldown')
    return jsonSuccess({ requested: true })
  }

  try {
    await sendPasswordResetEmail({
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
    })
  } catch (error) {
    // The timestamp is stamped only after a successful send: a failed send must
    // not start a cooldown, or a transient Resend outage locks the user out of
    // retrying for a minute for no reason.
    logger.error({ error, userId: user.id }, 'Failed to send the password reset email')
    return jsonSuccess({ requested: true })
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetEmailSentAt: new Date() },
    })
  } catch (error) {
    // The mail is already away; only the cooldown bookkeeping failed. Report
    // the same thing either way and log for the operator.
    logger.error(
      { error, userId: user.id },
      'Sent the password reset email but failed to record its cooldown timestamp',
    )
  }

  logger.info({ userId: user.id }, 'Password reset email sent')

  return jsonSuccess({ requested: true })
})
