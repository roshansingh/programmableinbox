import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assertConfig } from '../assert'
import { ConfigError, resetConfigCache } from '../index'

const originalEnv = { ...process.env }

/** The minimum environment in which every domain parses cleanly. */
function setValidEnv() {
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db?options=-c%20timezone%3DUTC'
  process.env.JWT_SECRET = 'j'.repeat(32)
  process.env.WEBHOOK_SECRET = 'w'.repeat(16)
  process.env.AUTH_RESEND_API_KEY = 're_test_placeholder'
  process.env.AUTH_EMAIL_FROM = 'no-reply@example.com'
  process.env.AUTH_EMAIL_FROM_NAME = 'Inbox'
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
    // Nothing set at all — the shape of a brand-new deployment.
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
    expect(() => assertConfig()).toThrow(/\.env\.example/)
  })
})
