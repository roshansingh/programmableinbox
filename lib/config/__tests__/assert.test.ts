import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assertConfig } from '../assert'
import { ConfigError, resetConfigCache } from '../index'

const originalEnv = { ...process.env }

const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'WEBHOOK_SECRET',
  'AUTH_RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
  'AUTH_EMAIL_FROM_NAME',
  'EMAIL_INBOX_DOMAINS',
] as const

/** Strips the valid baseline vitest.config.ts provides to every suite. */
function clearRequiredEnv() {
  for (const name of REQUIRED_VARS) delete process.env[name]
}

/** The minimum environment in which every domain parses cleanly. */
function setValidEnv() {
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db?options=-c%20timezone%3DUTC'
  process.env.JWT_SECRET = 'j'.repeat(32)
  process.env.WEBHOOK_SECRET = 'w'.repeat(16)
  process.env.AUTH_RESEND_API_KEY = 're_test_placeholder'
  process.env.AUTH_EMAIL_FROM = 'no-reply@example.com'
  process.env.AUTH_EMAIL_FROM_NAME = 'Inbox'
  process.env.EMAIL_INBOX_DOMAINS = 'inbox.example.com'
}

beforeEach(() => {
  process.env = { ...originalEnv }
  resetConfigCache()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetConfigCache()
})

describe('assertConfig', () => {
  it('passes on a fully valid environment', () => {
    setValidEnv()
    expect(() => assertConfig()).not.toThrow()
  })

  it('reports every failing variable at once, not just the first', () => {
    setValidEnv()
    process.env.LOG_LEVEL = 'warning'
    process.env.WEBHOOK_QUEUE_MAX_RETRIES = 'abc'
    process.env.REDIS_URL = 'not-a-url'
    process.env.LLM_PROVIDER = 'anthropik'

    let message = ''
    try {
      assertConfig()
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('LOG_LEVEL')
    expect(message).toContain('WEBHOOK_QUEUE_MAX_RETRIES')
    expect(message).toContain('REDIS_URL')
    expect(message).toContain('LLM_PROVIDER')
  })

  it('reports every missing required variable at once', () => {
    // The shape of a brand-new deployment: nothing configured yet. The suite
    // runs against the valid baseline from vitest.config.ts, so strip it first.
    clearRequiredEnv()

    let variables: readonly string[] = []
    try {
      assertConfig()
    } catch (error) {
      variables = (error as ConfigError).variables
    }

    expect(variables).toContain('DATABASE_URL')
    expect(variables).toContain('JWT_SECRET')
    expect(variables).toContain('WEBHOOK_SECRET')
    expect(variables).toContain('AUTH_RESEND_API_KEY')
  })

  it('throws a ConfigError carrying the offending variable names', () => {
    setValidEnv()
    process.env.LOG_LEVEL = 'warning'

    try {
      assertConfig()
      throw new Error('expected assertConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).variables).toEqual(['LOG_LEVEL'])
    }
  })

  it('requires a usable REDIS_URL when async webhook processing is enabled', () => {
    setValidEnv()
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
    process.env.REDIS_URL = 'http://localhost:6379'

    expect(() => assertConfig()).toThrow(/REDIS_URL/)
  })

  it('requires REDIS_URL to be set at all when async processing is enabled', () => {
    // The variable has no default, so "unset" is a distinct failure from
    // "malformed" and has to be caught at boot rather than at first enqueue.
    setValidEnv()
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
    delete process.env.REDIS_URL

    expect(() => assertConfig()).toThrow(/REDIS_URL is required/)
  })

  it('does not require REDIS_URL when async processing and rate limiting are both off', () => {
    setValidEnv()
    delete process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING
    process.env.AUTH_RATE_LIMIT_ENABLED = 'false'
    delete process.env.REDIS_URL

    expect(() => assertConfig()).not.toThrow()
  })

  it('requires REDIS_URL because auth rate limiting is on by default', () => {
    // The whole point of the default: an operator who never heard of this
    // feature still gets a boot failure naming the variable, rather than a
    // silently unthrottled login endpoint.
    setValidEnv()
    delete process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING
    delete process.env.AUTH_RATE_LIMIT_ENABLED
    delete process.env.REDIS_URL

    expect(() => assertConfig()).toThrow(/REDIS_URL is required/)
  })

  it('names the opt-out in the rate-limit failure so the fix is discoverable', () => {
    setValidEnv()
    // Deleted rather than left ambient: the test suite runs with the limiter
    // switched off (see `configEnv` in vitest.config.ts), and this test is
    // about the *production* default, where it is on.
    delete process.env.AUTH_RATE_LIMIT_ENABLED
    delete process.env.REDIS_URL

    expect(() => assertConfig()).toThrow(/AUTH_RATE_LIMIT_ENABLED=false/)
  })

  it('reports both reasons when async processing and rate limiting each need Redis', () => {
    setValidEnv()
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
    process.env.AUTH_RATE_LIMIT_ENABLED = 'true'
    delete process.env.REDIS_URL

    expect(() => assertConfig()).toThrow(
      /ENABLE_ASYNC_WEBHOOK_PROCESSING or AUTH_RATE_LIMIT_ENABLED are enabled/,
    )
  })

  it('reports REDIS_URL once when it is both malformed and required', () => {
    // Guards the `variables.includes('REDIS_URL')` short-circuit: the schema
    // failure and the cross-domain requirement must not both fire.
    setValidEnv()
    process.env.REDIS_URL = 'http://localhost:6379'

    try {
      assertConfig()
      throw new Error('expected assertConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).variables).toEqual(['REDIS_URL'])
    }
  })

  it('accepts async webhook processing with a valid REDIS_URL', () => {
    setValidEnv()
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
    process.env.REDIS_URL = 'redis://localhost:6379'

    expect(() => assertConfig()).not.toThrow()
  })

  it('does not echo secret values', () => {
    setValidEnv()
    process.env.JWT_SECRET = 'tooshort'

    try {
      assertConfig()
      throw new Error('expected assertConfig to throw')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('JWT_SECRET')
      expect(message).not.toContain('tooshort')
    }
  })

  it('points the operator at .env.example', () => {
    clearRequiredEnv()
    expect(() => assertConfig()).toThrow(/\.env\.example/)
  })
})
