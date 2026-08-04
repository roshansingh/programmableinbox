import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { withConfigEnv } from '@/test/config'

const LINK_SECRET = 'email-link-secret-at-least-16-chars'
const SESSION_SECRET = 'test-jwt-secret-at-least-16-chars'

const ENV = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_LINK_SECRET: LINK_SECRET,
  APP_BASE_URL: 'https://app.example.com',
  JWT_SECRET: SESSION_SECRET,
}

const CLAIMS = {
  userId: 'user_1',
  email: 'user@example.com',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
}

describe('password reset tokens', () => {
  withConfigEnv(ENV)

  it('round-trips the claims it was signed with', async () => {
    const { signPasswordResetToken, verifyPasswordResetToken, passwordFingerprint } =
      await import('../password-reset-token')

    const result = verifyPasswordResetToken(signPasswordResetToken(CLAIMS))

    expect(result).toEqual({
      ok: true,
      claims: {
        purpose: 'password_reset',
        userId: 'user_1',
        email: 'user@example.com',
        pwh: passwordFingerprint(CLAIMS.passwordHash),
      },
    })
  })

  it('reports an expired token distinctly from an invalid one', async () => {
    const { verifyPasswordResetToken, passwordFingerprint } = await import(
      '../password-reset-token'
    )

    const expired = jwt.sign(
      {
        purpose: 'password_reset',
        userId: 'user_1',
        email: 'user@example.com',
        pwh: passwordFingerprint(CLAIMS.passwordHash),
      },
      LINK_SECRET,
      { expiresIn: -10 },
    )

    expect(verifyPasswordResetToken(expired)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a tampered payload', async () => {
    const { signPasswordResetToken, verifyPasswordResetToken } = await import(
      '../password-reset-token'
    )

    const [header, , signature] = signPasswordResetToken(CLAIMS).split('.')
    const forged = Buffer.from(
      JSON.stringify({
        purpose: 'password_reset',
        userId: 'attacker',
        email: 'a@b.com',
        pwh: 'x',
      }),
    ).toString('base64url')

    expect(verifyPasswordResetToken(`${header}.${forged}.${signature}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it.each(['purpose', 'userId', 'email', 'pwh'])('rejects a token missing %s', async (claim) => {
    const { verifyPasswordResetToken, passwordFingerprint } = await import(
      '../password-reset-token'
    )

    const payload: Record<string, unknown> = {
      purpose: 'password_reset',
      userId: 'user_1',
      email: 'user@example.com',
      pwh: passwordFingerprint(CLAIMS.passwordHash),
    }
    delete payload[claim]

    expect(verifyPasswordResetToken(jwt.sign(payload, LINK_SECRET))).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('produces a different fingerprint for a different hash', async () => {
    const { passwordFingerprint } = await import('../password-reset-token')

    expect(passwordFingerprint('$2b$10$aaa')).not.toBe(passwordFingerprint('$2b$10$bbb'))
  })

  it('does not leak the hash it fingerprints', async () => {
    const { passwordFingerprint } = await import('../password-reset-token')

    const hash = '$2b$10$abcdefghijklmnopqrstuv'
    expect(passwordFingerprint(hash)).not.toContain(hash.slice(7))
  })

  // ---------------------------------------------------------------------
  // Cross-purpose confusion.
  //
  // Both token types are signed with EMAIL_LINK_SECRET, so the signature
  // check CANNOT reject either of these — the `purpose` claim is the only
  // thing separating them. These tests are the barrier. Do not weaken them,
  // and do not "simplify" either verifier's purpose check.
  // ---------------------------------------------------------------------

  it('refuses a genuine verification token', async () => {
    const { verifyPasswordResetToken } = await import('../password-reset-token')
    const { signVerificationToken } = await import('../verification-token')

    // Signed by this server, with a valid signature under the shared key.
    // Only `purpose` stands between it and a password reset.
    const verificationToken = signVerificationToken({
      userId: 'user_1',
      email: 'user@example.com',
    })

    expect(verifyPasswordResetToken(verificationToken)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('refuses a token carrying every reset claim but the wrong purpose', async () => {
    const { verifyPasswordResetToken, passwordFingerprint } = await import(
      '../password-reset-token'
    )

    const wrongPurpose = jwt.sign(
      {
        purpose: 'email_verify',
        userId: 'user_1',
        email: 'user@example.com',
        pwh: passwordFingerprint(CLAIMS.passwordHash),
      },
      LINK_SECRET,
    )

    expect(verifyPasswordResetToken(wrongPurpose)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is refused by the verification verifier', async () => {
    const { signPasswordResetToken } = await import('../password-reset-token')
    const { verifyVerificationToken } = await import('../verification-token')

    expect(verifyVerificationToken(signPasswordResetToken(CLAIMS))).toEqual({
      ok: false,
      reason: 'invalid',
    })

    const wrongPurpose = jwt.sign(
      { purpose: 'password_reset', userId: 'user_1', email: 'user@example.com' },
      LINK_SECRET,
    )
    expect(verifyVerificationToken(wrongPurpose)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is never accepted as a session token', async () => {
    const { signPasswordResetToken } = await import('../password-reset-token')
    const { verifyToken } = await import('../../auth-server')

    expect(verifyToken(signPasswordResetToken(CLAIMS))).toBeNull()
  })
})
