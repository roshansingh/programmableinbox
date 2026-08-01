import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Secret, config, resetConfigCache } from '../index'

const UTC_URL = 'postgresql://u:p@h:5432/db?options=-c%20timezone%3DUTC'
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv }
  resetConfigCache()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetConfigCache()
})

describe('config accessors', () => {
  it('returns parsed schema output, not the raw string', () => {
    process.env.WEBHOOK_SECRET = 'w'.repeat(16)
    process.env.WEBHOOK_QUEUE_MAX_RETRIES = '7'

    expect(config.webhooks.maxRetries).toBe(7)
    expect(typeof config.webhooks.maxRetries).toBe('number')
  })

  it('boxes secrets so a whole-domain log cannot leak them', () => {
    process.env.JWT_SECRET = 'j'.repeat(32)

    expect(config.auth.jwtSecret).toBeInstanceOf(Secret)
    expect(JSON.stringify(config.auth)).not.toContain('j'.repeat(32))
  })

  it('memoizes, so a later process.env mutation cannot reintroduce a raw value', () => {
    process.env.WEBHOOK_SECRET = 'w'.repeat(16)
    process.env.WEBHOOK_QUEUE_MAX_RETRIES = '7'
    expect(config.webhooks.maxRetries).toBe(7)

    process.env.WEBHOOK_QUEUE_MAX_RETRIES = '9'
    expect(config.webhooks.maxRetries).toBe(7)
  })

  it('does not read process.env at module load', async () => {
    // The whole reason accessors are lazy: `next build` evaluates every module
    // with no secrets present, so a top-level parse would fail the build
    // instead of the misconfigured deployment.
    process.env = {} as NodeJS.ProcessEnv
    await expect(import('../index')).resolves.toBeDefined()
  })

  it('isolates domains: a broken llm config does not break db', () => {
    process.env.DATABASE_URL = UTC_URL
    process.env.LLM_PROVIDER = 'nonsense'

    expect(config.db.url).toBe(UTC_URL)
    expect(() => config.llm.provider).toThrow()
  })

  it('names the variable and the constraint when a domain fails', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    expect(() => config.db.url).toThrow(/DATABASE_URL/)
  })

  it('reports a missing required variable as absent rather than as a type error', () => {
    delete process.env.DATABASE_URL
    expect(() => config.db.url).toThrow(/DATABASE_URL is required but not set/)
  })

  it('treats a blank variable as unset', () => {
    process.env.WEBHOOK_SECRET = 'w'.repeat(16)
    process.env.WEBHOOK_QUEUE_MAX_RETRIES = '   '
    expect(config.webhooks.maxRetries).toBe(3)
  })

  it('never includes a secret value in the thrown message', () => {
    process.env.JWT_SECRET = 'leaky-but-too-short'.slice(0, 5)

    try {
      void config.auth.jwtSecret
      throw new Error('expected config.auth to throw')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('JWT_SECRET')
      expect(message).not.toContain('leaky')
    }
  })

  it('reports every failure within a domain at once', () => {
    process.env.WEBHOOK_QUEUE_MAX_RETRIES = 'abc'
    process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX = 'xyz'
    delete process.env.WEBHOOK_SECRET

    let message = ''
    try {
      void config.webhooks.maxRetries
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('WEBHOOK_SECRET')
    expect(message).toContain('WEBHOOK_QUEUE_MAX_RETRIES')
    expect(message).toContain('WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX')
  })

  it('exposes ConfigError with the offending variable names attached', async () => {
    const { ConfigError } = await import('../index')
    process.env.LOG_LEVEL = 'warning'

    try {
      void config.logging.level
      throw new Error('expected config.logging to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as InstanceType<typeof ConfigError>).variables).toContain('LOG_LEVEL')
    }
  })
})
