import { describe, expect, it } from 'vitest'
import { config, parseDomain, requireEmailVerification } from '@/lib/config'
import { assertConfig } from '@/lib/config/assert'
import { setConfigEnv, withConfigEnv } from '@/test/config'

const SECRET = 'verification-secret-at-least-16'

/**
 * The flag is conditionally-required configuration, on the REDIS_URL /
 * ASYNC_WEBHOOK_PROCESSING_ENABLED precedent (issue #102 §4.2). The failure
 * mode being prevented is specific: an operator flips the flag, forgets the
 * secret, and the server starts anyway — signing up users and silently mailing
 * nobody.
 */
describe('emailVerification config', () => {
  withConfigEnv({
    EMAIL_VERIFICATION_ENABLED: undefined,
    EMAIL_LINK_SIGNING_SECRET: undefined,
    APP_BASE_URL: undefined,
  })

  it('parses with nothing set, and reports the feature as off', () => {
    expect(parseDomain('emailVerification')).toEqual({
      enabled: false,
      secret: null,
      appBaseUrl: null,
      tokenTtlMinutes: 30,
      passwordResetTtlMinutes: 30,
    })
  })

  it('parses when fully configured', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: SECRET,
      APP_BASE_URL: 'https://app.example.com',
    })

    const parsed = parseDomain('emailVerification')
    expect(parsed.enabled).toBe(true)
    expect(parsed.appBaseUrl).toBe('https://app.example.com')
    expect(parsed.secret?.reveal()).toBe(SECRET)
  })

  it('throws naming EMAIL_LINK_SIGNING_SECRET when the flag is on without it', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).toThrow(/EMAIL_LINK_SIGNING_SECRET/)
  })

  it('throws naming APP_BASE_URL when the flag is on without it', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: SECRET,
    })

    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)
  })

  it('rejects a secret that is too short rather than accepting a placeholder', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: 'short',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).toThrow(/EMAIL_LINK_SIGNING_SECRET/)
  })

  it('rejects a relative or non-http APP_BASE_URL', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: SECRET,
      APP_BASE_URL: '/app',
    })
    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)

    setConfigEnv({ APP_BASE_URL: 'ftp://app.example.com' })
    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)
  })

  /** Set-but-invalid throws; it never falls back to "feature off". */
  it('rejects a malformed flag value instead of reading it as false', () => {
    setConfigEnv({ EMAIL_VERIFICATION_ENABLED: 'maybe' })
    expect(() => parseDomain('emailVerification')).toThrow(/EMAIL_VERIFICATION_ENABLED/)
  })

  it('reports both missing variables in one aggregated boot failure', () => {
    setConfigEnv({ EMAIL_VERIFICATION_ENABLED: 'true' })

    try {
      assertConfig()
      expect.unreachable('assertConfig should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('EMAIL_LINK_SIGNING_SECRET')
      expect(message).toContain('APP_BASE_URL')
      expect((error as { variables: string[] }).variables).toEqual(
        expect.arrayContaining(['EMAIL_LINK_SIGNING_SECRET', 'APP_BASE_URL']),
      )
    }
  })

  it('never prints the secret in a validation error', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: 'short',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).not.toThrow(/short/)
  })

  it('boxes the secret so it cannot be logged by accident', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: SECRET,
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(JSON.stringify(config.emailVerification)).not.toContain(SECRET)
    expect(String(config.emailVerification.secret)).toBe('[redacted]')
  })
})

describe('requireEmailVerification', () => {
  withConfigEnv({
    EMAIL_VERIFICATION_ENABLED: undefined,
    EMAIL_LINK_SIGNING_SECRET: undefined,
    APP_BASE_URL: undefined,
  })

  it('returns the revealed secret and origin when configured', () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: SECRET,
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(requireEmailVerification()).toEqual({
      secret: SECRET,
      appBaseUrl: 'https://app.example.com',
    })
  })

  /**
   * The reachable-after-boot case: a caller that signs a token without first
   * checking `config.emailVerification.enabled`. It must name the variables
   * rather than dereference null somewhere inside the mailer.
   */
  it('throws naming both variables when the feature was never configured', () => {
    expect(() => requireEmailVerification()).toThrow(/EMAIL_LINK_SIGNING_SECRET/)
    expect(() => requireEmailVerification()).toThrow(/APP_BASE_URL/)
  })
})

describe('emailed link TTLs', () => {
  withConfigEnv({ EMAIL_VERIFICATION_ENABLED: 'false' })

  it('defaults both TTLs to 30 minutes', async () => {
    const { config } = await import('@/lib/config')

    expect(config.emailVerification.tokenTtlMinutes).toBe(30)
    expect(config.emailVerification.passwordResetTtlMinutes).toBe(30)
  })

  it('rejects a non-integer TTL rather than falling back to the default', async () => {
    setConfigEnv({ EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '30m' })
    const { config } = await import('@/lib/config')

    expect(() => config.emailVerification.tokenTtlMinutes).toThrow(/must be an integer/)
  })

  it('rejects a TTL below the lower bound', async () => {
    setConfigEnv({ AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES: '0' })
    const { config } = await import('@/lib/config')

    expect(() => config.emailVerification.passwordResetTtlMinutes).toThrow()
  })

  it('rejects a TTL above the upper bound', async () => {
    setConfigEnv({ AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES: '10081' })
    const { config } = await import('@/lib/config')

    expect(() => config.emailVerification.passwordResetTtlMinutes).toThrow()
  })

  it('does not honour the old EMAIL_VERIFICATION_SECRET name as a fallback', async () => {
    setConfigEnv({
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_LINK_SIGNING_SECRET: undefined,
      EMAIL_VERIFICATION_SECRET: 'old-name-secret-at-least-16-chars',
      APP_BASE_URL: 'https://app.example.com',
    })
    const { config } = await import('@/lib/config')

    // A deployment that updated only half its config must fail loudly rather
    // than quietly signing with a value the schema no longer reads.
    expect(() => config.emailVerification.enabled).toThrow(/EMAIL_LINK_SIGNING_SECRET/)
  })
})
