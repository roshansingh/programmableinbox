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
import { config, requireEmailVerification } from '@/lib/config'

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
 * The TTL now comes from `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` (default 30).
 *
 * Read per call rather than captured at module load, for the same reason
 * `getJwtSecret()` is: `next build` evaluates this module with no environment
 * present, so a module-scope read would break the build rather than the
 * misconfigured deployment.
 *
 * Converted to seconds here rather than handing `jwt.sign` an `ms`-format
 * string: an unrecognised duration string throws from inside `sign`, at signup
 * time, whereas an integer is validated at boot by `assertConfig()`.
 */
function ttlSeconds(): number {
  return config.emailVerification.tokenTtlMinutes * 60
}

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
    { expiresIn: ttlSeconds() },
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

  // Load-bearing, not a backstop. lib/auth/password-reset-token.ts is the
  // second purpose, and it is signed with the SAME key — EMAIL_LINK_SECRET —
  // so the signature check cannot tell the two token types apart. This
  // equality test is the only thing that can. A reset token presented here
  // would otherwise verify, and vice versa.
  //
  // Do not relax it, and do not read any other claim before it.
  if (purpose !== VERIFICATION_PURPOSE) return { ok: false, reason: 'invalid' }
  if (typeof userId !== 'string' || userId === '') return { ok: false, reason: 'invalid' }
  if (typeof email !== 'string' || email === '') return { ok: false, reason: 'invalid' }

  return { ok: true, claims: { purpose: VERIFICATION_PURPOSE, userId, email } }
}
