/**
 * The only module that signs or verifies email-verification tokens (issue
 * #102).
 *
 * `server-only` because it reads `EMAIL_LINK_SECRET` through
 * `lib/config`. A client component importing this must fail the build rather
 * than shipping a signing key to the browser.
 */
import 'server-only'
import jwt from 'jsonwebtoken'
import { requireEmailVerification } from '@/lib/config'

/**
 * Stateless by design: no token table, no cleanup job.
 *
 * The token is not revocable, and a resend does not invalidate previously-sent
 * links. Both are accepted because redemption is idempotent and self-limiting:
 * it grants exactly one state transition, `emailVerified: false → true`, for
 * one specific `(userId, email)` pair, and confers no session, no scope and no
 * other authority. A link leaked inside its window lets an attacker mark a
 * user's own address as verified, which is not a capability worth having.
 *
 * `email` is in the claims so that changing the address invalidates every
 * outstanding link for that user — the confirm route compares the claim
 * against the address currently on the row.
 */
const VERIFICATION_PURPOSE = 'email_verify'

/**
 * Long enough that a link found the next morning still works, short enough
 * that a token sitting in an archived mailbox is not indefinitely live.
 *
 * A constant rather than an env var: this is a product decision, not a
 * per-deployment one, and every additional variable is another thing
 * `assertConfig()` has to explain.
 */
export const VERIFICATION_TOKEN_TTL = '24h'

/** Minimum gap between verification sends for one user. See §7.4. */
export const RESEND_COOLDOWN_SECONDS = 60

export type VerificationClaims = {
  purpose: typeof VERIFICATION_PURPOSE
  userId: string
  email: string
}

/**
 * Verification returns a result rather than `VerificationClaims | null`.
 *
 * `/auth/verify` has to tell "this link expired — send a new one" apart from
 * "this link is invalid", and a null cannot carry that. Every non-expiry
 * failure — bad signature, wrong secret, wrong purpose, missing claim,
 * malformed string — collapses to `invalid` on purpose: a caller able to
 * forge a plausible token shape must not learn which part it got wrong.
 */
export type VerificationResult =
  | { ok: true; claims: VerificationClaims }
  | { ok: false; reason: 'expired' | 'invalid' }

export function signVerificationToken(claims: { userId: string; email: string }): string {
  const { secret } = requireEmailVerification()

  return jwt.sign(
    { purpose: VERIFICATION_PURPOSE, userId: claims.userId, email: claims.email },
    secret,
    { expiresIn: VERIFICATION_TOKEN_TTL },
  )
}

export function verifyVerificationToken(token: string): VerificationResult {
  // Resolved outside the try on purpose, exactly as `getJwtSecret()` is in
  // lib/auth-server: a misconfigured secret must surface as a thrown error
  // rather than be swallowed into the `invalid` path, where it is
  // indistinguishable from a merely bad link.
  const { secret } = requireEmailVerification()

  let payload: unknown
  try {
    payload = jwt.verify(token, secret)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid',
    }
  }

  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'invalid' }
  }

  const { purpose, userId, email } = payload as Record<string, unknown>

  // The second of the three barriers in §6.1. The differing secret already
  // closes the confusion attack; this exists so that a future refactor which
  // "simplifies" the secrets does not silently reopen it, and so that a second
  // purpose (password reset) added to this module cannot redeem a verification
  // link.
  if (purpose !== VERIFICATION_PURPOSE) return { ok: false, reason: 'invalid' }
  if (typeof userId !== 'string' || userId === '') return { ok: false, reason: 'invalid' }
  if (typeof email !== 'string' || email === '') return { ok: false, reason: 'invalid' }

  return { ok: true, claims: { purpose: VERIFICATION_PURPOSE, userId, email } }
}
