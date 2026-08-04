import { describe, expect, it } from 'vitest'
import { config, parseDomain, requireEmailVerification } from '@/lib/config'
import { assertConfig } from '@/lib/config/assert'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const SECRET = 'verification-secret-at-least-16'

/**
 * The flag is conditionally-required configuration, on the REDIS_URL /
 * ENABLE_ASYNC_WEBHOOK_PROCESSING precedent (issue #102 §4.2). The failure
 * mode being prevented is specific: an operator flips the flag, forgets the
 * secret, and the server starts anyway — signing up users and silently mailing
 * nobody.
 */
describe('emailVerification config', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: undefined,
    EMAIL_LINK_SECRET: undefined,
    APP_BASE_URL: undefined,
  })

  it('parses with nothing set, and reports the feature as off', () => {
    expect(parseDomain('emailVerification')).toEqual({
      enabled: false,
      secret: null,
      appBaseUrl: null,
    })
  })

  it('parses when fully configured', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: SECRET,
      APP_BASE_URL: 'https://app.example.com',
    })

    const parsed = parseDomain('emailVerification')
    expect(parsed.enabled).toBe(true)
    expect(parsed.appBaseUrl).toBe('https://app.example.com')
    expect(parsed.secret?.reveal()).toBe(SECRET)
  })

  it('throws naming EMAIL_LINK_SECRET when the flag is on without it', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).toThrow(/EMAIL_LINK_SECRET/)
  })

  it('throws naming APP_BASE_URL when the flag is on without it', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: SECRET,
    })

    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)
  })

  it('rejects a secret that is too short rather than accepting a placeholder', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: 'short',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).toThrow(/EMAIL_LINK_SECRET/)
  })

  it('rejects a relative or non-http APP_BASE_URL', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: SECRET,
      APP_BASE_URL: '/app',
    })
    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)

    setConfigEnv({ APP_BASE_URL: 'ftp://app.example.com' })
    expect(() => parseDomain('emailVerification')).toThrow(/APP_BASE_URL/)
  })

  /** Set-but-invalid throws; it never falls back to "feature off". */
  it('rejects a malformed flag value instead of reading it as false', () => {
    setConfigEnv({ ENABLE_EMAIL_VERIFICATION: 'maybe' })
    expect(() => parseDomain('emailVerification')).toThrow(/ENABLE_EMAIL_VERIFICATION/)
  })

  it('reports both missing variables in one aggregated boot failure', () => {
    setConfigEnv({ ENABLE_EMAIL_VERIFICATION: 'true' })

    try {
      assertConfig()
      expect.unreachable('assertConfig should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('EMAIL_LINK_SECRET')
      expect(message).toContain('APP_BASE_URL')
      expect((error as { variables: string[] }).variables).toEqual(
        expect.arrayContaining(['EMAIL_LINK_SECRET', 'APP_BASE_URL']),
      )
    }
  })

  it('never prints the secret in a validation error', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: 'short',
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(() => parseDomain('emailVerification')).not.toThrow(/short/)
  })

  it('boxes the secret so it cannot be logged by accident', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: SECRET,
      APP_BASE_URL: 'https://app.example.com',
    })

    expect(JSON.stringify(config.emailVerification)).not.toContain(SECRET)
    expect(String(config.emailVerification.secret)).toBe('[redacted]')
  })
})

describe('requireEmailVerification', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: undefined,
    EMAIL_LINK_SECRET: undefined,
    APP_BASE_URL: undefined,
  })

  it('returns the revealed secret and origin when configured', () => {
    setConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: SECRET,
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
    expect(() => requireEmailVerification()).toThrow(/EMAIL_LINK_SECRET/)
    expect(() => requireEmailVerification()).toThrow(/APP_BASE_URL/)
  })
})
