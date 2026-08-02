import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import { verifyVerificationToken } from '@/lib/auth/verification-token'
import logger from '@/lib/logger'

/**
 * Every rejection that is not an expiry says the same thing (issue #102 §7.3).
 *
 * Invalid signature, wrong purpose, deleted user and "the address on the token
 * is no longer this user's address" are deliberately not distinguishable: a
 * caller able to produce a plausible token shape would otherwise have an
 * account-existence oracle.
 */
const INVALID = 'This verification link is invalid'
const EXPIRED = 'This verification link has expired'
const SUPERSEDED = 'This link is no longer valid'

/**
 * `withPublic`, not `withUser`, and that is the point.
 *
 * The link is routinely opened on a different device from the one holding the
 * session — signed up on a desktop, opened the mail on a phone. Requiring a
 * session would strand exactly the users this flow exists to serve. The token
 * *is* the credential, it is signed with a secret no session token uses, and it
 * authorizes precisely one state change for one `(userId, email)` pair.
 */
export const POST = withPublic(async (request: NextRequest) => {
  // 404 rather than 400: with the flag off this is not a misused endpoint, it
  // is a feature the deployment does not have.
  if (!config.emailVerification.enabled) {
    return jsonError('Not found', 404)
  }

  let token: unknown
  try {
    ;({ token } = await request.json())
  } catch {
    return jsonError(INVALID, 400)
  }

  if (typeof token !== 'string' || token === '') {
    return jsonError(INVALID, 400)
  }

  const result = verifyVerificationToken(token)
  if (!result.ok) {
    return jsonError(result.reason === 'expired' ? EXPIRED : INVALID, 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: result.claims.userId },
    select: { id: true, email: true, emailVerified: true },
  })

  if (!user) return jsonError(INVALID, 400)

  // The email in the claims is what makes a stateless token safe to leave
  // un-revoked: changing the address invalidates every link outstanding for
  // that user, without a token table to sweep.
  if (user.email !== result.claims.email) {
    return jsonError(SUPERSEDED, 400)
  }

  // Already verified is a success no-op, not an error. A mail scanner or a
  // link preview will have pre-fetched the URL before the human ever clicks
  // it; the second redemption must not show them a failure.
  if (user.emailVerified) {
    return jsonSuccess({ verified: true })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  })

  logger.info({ userId: user.id }, 'Email address verified')

  return jsonSuccess({ verified: true })
})
