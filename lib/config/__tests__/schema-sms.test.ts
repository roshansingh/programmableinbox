import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * The `sms` domain: Twilio credentials for SMS inboxes (issue #140). Off by
 * default; when `SMS_ENABLED=true` both credentials are required and asserted
 * at boot, on the `OBSERVABILITY_ENABLED` / `COMMERCIAL_ENABLED` precedent.
 */
const VARS = ['SMS_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const

const ORIGINAL = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

const SID = 'AC' + 'a'.repeat(32)
const TOKEN = 't'.repeat(32)

function withEnv(values: Partial<Record<(typeof VARS)[number], string | undefined>>) {
  for (const name of VARS) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
  return parseDomain('sms')
}

function failureOf(values: Partial<Record<(typeof VARS)[number], string | undefined>>): ConfigError {
  try {
    withEnv(values)
  } catch (error) {
    if (error instanceof ConfigError) return error
    throw error
  }
  throw new Error('expected parseDomain to throw')
}

afterEach(() => {
  for (const name of VARS) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
})

describe('sms config domain', () => {
  it('is off by default, with no credentials required', () => {
    const config = withEnv({})
    expect(config.enabled).toBe(false)
    expect(config.accountSid).toBeNull()
    expect(config.authToken).toBeNull()
  })

  it('parses a complete configuration', () => {
    const config = withEnv({
      SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: SID,
      TWILIO_AUTH_TOKEN: TOKEN,
    })
    expect(config.enabled).toBe(true)
    expect(config.accountSid).toBe(SID)
    expect(config.authToken?.reveal()).toBe(TOKEN)
  })

  it('requires both credentials when enabled', () => {
    const error = failureOf({ SMS_ENABLED: 'true' })
    expect(error.variables).toContain('TWILIO_ACCOUNT_SID')
    expect(error.variables).toContain('TWILIO_AUTH_TOKEN')
  })

  it('treats a blank TWILIO_AUTH_TOKEN as missing', () => {
    const error = failureOf({
      SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: SID,
      TWILIO_AUTH_TOKEN: '',
    })
    expect(error.variables).toContain('TWILIO_AUTH_TOKEN')
    expect(error.variables).not.toContain('TWILIO_ACCOUNT_SID')
  })

  it.each([
    ['an API key SID', 'SK' + 'a'.repeat(32)],
    ['a value of the wrong shape', 'x'.repeat(32)],
    ['a too-short SID', 'AC' + 'a'.repeat(10)],
  ])('rejects %s without echoing it', (_label, bad) => {
    const error = failureOf({
      SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: bad,
      TWILIO_AUTH_TOKEN: TOKEN,
    })
    expect(error.variables).toContain('TWILIO_ACCOUNT_SID')
    expect(error.message).toContain('TWILIO_ACCOUNT_SID')
    expect(error.message).not.toContain(bad)
  })

  it('ignores credentials while disabled', () => {
    const config = withEnv({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN })
    expect(config.enabled).toBe(false)
    expect(config.accountSid).toBe(SID)
  })

  it('boxes the auth token', () => {
    const config = withEnv({
      SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: SID,
      TWILIO_AUTH_TOKEN: TOKEN,
    })
    expect(String(config.authToken)).toBe('[redacted]')
    expect(JSON.stringify(config)).not.toContain(TOKEN)
  })
})
