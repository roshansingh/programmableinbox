import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import { hashPassword } from '@/lib/auth-server'
import {
  passwordFingerprint,
  verifyPasswordResetToken,
} from '@/lib/auth/password-reset-token'
import { validatePassword } from '@/lib/validation/password'
import logger from '@/lib/logger'

/**
 * Rejection wording.
 *
 * A bad signature, the wrong purpose, a deleted user and an already-used link
 * all collapse to INVALID. Anything finer would let a caller holding a
 * plausible token shape probe for which accounts exist.
 *
 * The email-mismatch case is its own message. It is not an oracle, because
 * reaching it requires a token this server signed for a user that exists —
 * something an attacker cannot mint. It tells the person holding a genuine link
 * the one fact that explains the failure: the address it was issued for has
 * since changed.
 */
const INVALID = 'This reset link is invalid or has already been used'
const EXPIRED = 'This reset link has expired'
const SUPERSEDED = 'This link is no longer valid'

/**
 * `withPublic`, and necessarily so: the whole point is that the caller cannot
 * log in. The token is the credential. It is signed with a key no session token
 * and no verification link uses, and it authorizes exactly one change to one
 * account.
 *
 * Deliberately issues **no session**. The user signs in with the new password
 * afterwards, which proves the reset worked and keeps this endpoint from being
 * a way to obtain a session directly from an emailed link.
 */
export const POST = withPublic(async (request: NextRequest) => {
  if (!config.emailVerification.enabled) {
    return jsonError('Not found', 404)
  }

  let token: unknown
  let password: unknown
  try {
    ;({ token, password } = await request.json())
  } catch {
    return jsonError(INVALID, 400)
  }

  if (typeof token !== 'string' || token === '') {
    return jsonError(INVALID, 400)
  }

  const result = verifyPasswordResetToken(token)
  if (!result.ok) {
    return jsonError(result.reason === 'expired' ? EXPIRED : INVALID, 400)
  }

  // Checked before the row is read so a caller cannot use the strength rule as
  // a probe: the message is the same whether or not the account exists.
  const passwordError = validatePassword(password)
  if (passwordError) {
    return jsonError(passwordError, 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: result.claims.userId },
    select: { id: true, email: true, passwordHash: true },
  })

  if (!user) return jsonError(INVALID, 400)

  // Changing the address invalidates every link outstanding for that user,
  // without a token table to sweep.
  if (user.email !== result.claims.email) {
    return jsonError(SUPERSEDED, 400)
  }

  // What makes the token single-use. The fingerprint was taken from the hash
  // that existed when the link was signed; completing a reset changes the hash,
  // so a second redemption — or a link from before an earlier reset — fails
  // here with no server-side state to consult.
  if (passwordFingerprint(user.passwordHash) !== result.claims.pwh) {
    return jsonError(INVALID, 400)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password as string),
      // Evicts every session issued before now — see
      // resolveUserPrincipalFromToken. The reason someone resets a password is
      // often that someone else has one of those sessions.
      passwordChangedAt: new Date(),
      // The reset is done; a fresh request should not be held off by the
      // cooldown from the link that was just consumed.
      passwordResetEmailSentAt: null,
    },
  })

  logger.info({ userId: user.id }, 'Password reset completed')

  return jsonSuccess({ reset: true })
})
