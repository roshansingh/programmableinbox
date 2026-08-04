import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { withConfigEnv } from '@/test/config'

const SECRET = 'verification-secret-at-least-16-chars'
const SESSION_SECRET = 'test-jwt-secret-at-least-16-chars'

const CLAIMS = { userId: 'user_1', email: 'user@example.com' }

describe('verification tokens', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: 'true',
    EMAIL_LINK_SECRET: SECRET,
    APP_BASE_URL: 'https://app.example.com',
    JWT_SECRET: SESSION_SECRET,
  })

  it('round-trips the claims it was signed with', async () => {
    const { signVerificationToken, verifyVerificationToken } = await import(
      '../verification-token'
    )

    const result = verifyVerificationToken(signVerificationToken(CLAIMS))

    expect(result).toEqual({
      ok: true,
      claims: { purpose: 'email_verify', userId: 'user_1', email: 'user@example.com' },
    })
  })

  it('rejects a tampered payload', async () => {
    const { signVerificationToken, verifyVerificationToken } = await import(
      '../verification-token'
    )

    const [header, , signature] = signVerificationToken(CLAIMS).split('.')
    const forged = Buffer.from(
      JSON.stringify({ purpose: 'email_verify', userId: 'attacker', email: 'a@b.com' }),
    ).toString('base64url')

    expect(verifyVerificationToken(`${header}.${forged}.${signature}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects a token signed with a different secret', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    const foreign = jwt.sign({ purpose: 'email_verify', ...CLAIMS }, 'some-other-secret-16+', {
      expiresIn: '24h',
    })

    expect(verifyVerificationToken(foreign)).toEqual({ ok: false, reason: 'invalid' })
  })

  /**
   * Expiry is reported distinctly from every other failure so `/auth/verify`
   * can offer "send me a new one" rather than a generic "invalid link", which
   * for an expired link is both true and useless.
   */
  it('reports an expired token as expired, not as invalid', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    const stale = jwt.sign({ purpose: 'email_verify', ...CLAIMS }, SECRET, { expiresIn: '-1s' })

    expect(verifyVerificationToken(stale)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a correctly-signed token that carries no purpose', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    const purposeless = jwt.sign(CLAIMS, SECRET, { expiresIn: '24h' })

    expect(verifyVerificationToken(purposeless)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a correctly-signed token carrying some other purpose', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    const wrongPurpose = jwt.sign({ purpose: 'password_reset', ...CLAIMS }, SECRET, {
      expiresIn: '24h',
    })

    expect(verifyVerificationToken(wrongPurpose)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a token missing userId or email', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    expect(
      verifyVerificationToken(jwt.sign({ purpose: 'email_verify' }, SECRET, { expiresIn: '24h' })),
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a malformed string', async () => {
    const { verifyVerificationToken } = await import('../verification-token')

    expect(verifyVerificationToken('not-a-jwt')).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyVerificationToken('')).toEqual({ ok: false, reason: 'invalid' })
  })
})

/**
 * The load-bearing boundary (§6.1). A verification token travels by email — it
 * sits in mail provider logs, corporate link scanners and browser history — so
 * it must be worthless as a session credential, and a session token must be
 * worthless as a verification link. This repo already removed one instance of
 * the RFC 8725 §2.8 Cross-JWT Confusion class (`resolveAuthContext`);
 * reintroducing it through an emailed URL would be strictly worse.
 */
describe('cross-purpose token separation', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: 'true',
    EMAIL_LINK_SECRET: SECRET,
    APP_BASE_URL: 'https://app.example.com',
    JWT_SECRET: SESSION_SECRET,
  })

  it('a verification token is not a session token', async () => {
    const { signVerificationToken } = await import('../verification-token')
    const { verifyToken } = await import('@/lib/auth-server')

    expect(verifyToken(signVerificationToken(CLAIMS))).toBeNull()
  })

  it('a session token is not a verification token', async () => {
    const { verifyVerificationToken } = await import('../verification-token')
    const { signToken } = await import('@/lib/auth-server')

    expect(verifyVerificationToken(signToken({ userId: 'user_1' }))).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  /**
   * Defence in depth. Today the differing secret already makes this
   * unreachable; the check keeps it unreachable if a future refactor ever
   * unifies the two secrets.
   */
  it('verifyToken rejects any payload carrying a purpose claim, even under the session secret', async () => {
    const { verifyToken } = await import('@/lib/auth-server')

    const confusing = jwt.sign(
      { purpose: 'email_verify', userId: 'user_1', email: 'user@example.com' },
      SESSION_SECRET,
      { expiresIn: '7d' },
    )

    expect(verifyToken(confusing)).toBeNull()
  })

  it('verifyToken still accepts an ordinary session token', async () => {
    const { signToken, verifyToken } = await import('@/lib/auth-server')

    expect(verifyToken(signToken({ userId: 'user_1' }))?.userId).toBe('user_1')
  })
})
