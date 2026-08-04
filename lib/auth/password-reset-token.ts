/**
 * The only module that signs or verifies password-reset tokens.
 *
 * `server-only` because it reads `EMAIL_LINK_SECRET` through `lib/config`.
 * A client component importing this must fail the build rather than shipping a
 * signing key to the browser.
 */
import 'server-only'
import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config, requireEmailVerification } from '@/lib/config'

/**
 * Distinct from the verification module's `email_verify`, and checked strictly
 * before any other claim is read.
 *
 * This is the second of two barriers between the token types — the first being
 * that they are signed with different keys, which `lib/config/schema.ts`
 * refuses to let a deployment collapse by setting both to the same value.
 */
const RESET_PURPOSE = 'password_reset'

/**
 * Unlike a verification token, a reset token must be single-use.
 *
 * Verification is safe to leave un-revoked because redemption grants one
 * idempotent boolean flip. A reset token grants account takeover, so
 * "redeemable twice" is not acceptable — but a token table would need a
 * sweeper, and this codebase deliberately has neither.
 *
 * `pwh` closes that gap without server state: it is a fingerprint of the
 * password hash the token was issued against. Completing a reset changes the
 * hash, so every outstanding link for that user stops verifying at once. The
 * fingerprint is truncated and one-way, so the token does not carry the hash
 * itself into a mailbox.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 16)
}

/** Read per call, not at module load — see the note in verification-token.ts. */
function ttlSeconds(): number {
  return config.emailVerification.passwordResetTtlMinutes * 60
}

export type PasswordResetClaims = {
  purpose: typeof RESET_PURPOSE
  userId: string
  email: string
  pwh: string
}

export type PasswordResetResult =
  | { ok: true; claims: PasswordResetClaims }
  | { ok: false; reason: 'expired' | 'invalid' }

export function signPasswordResetToken(claims: {
  userId: string
  email: string
  passwordHash: string
}): string {
  const { secret } = requireEmailVerification()

  return jwt.sign(
    {
      purpose: RESET_PURPOSE,
      userId: claims.userId,
      email: claims.email,
      pwh: passwordFingerprint(claims.passwordHash),
    },
    secret,
    { expiresIn: ttlSeconds() },
  )
}

export function verifyPasswordResetToken(token: string): PasswordResetResult {
  // Resolved outside the try on purpose: a misconfigured secret must surface as
  // a thrown error rather than be swallowed into the `invalid` path, where it
  // is indistinguishable from a merely bad link.
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

  const { purpose, userId, email, pwh } = payload as Record<string, unknown>

  if (purpose !== RESET_PURPOSE) return { ok: false, reason: 'invalid' }
  if (typeof userId !== 'string' || userId === '') return { ok: false, reason: 'invalid' }
  if (typeof email !== 'string' || email === '') return { ok: false, reason: 'invalid' }
  if (typeof pwh !== 'string' || pwh === '') return { ok: false, reason: 'invalid' }

  return { ok: true, claims: { purpose: RESET_PURPOSE, userId, email, pwh } }
}
