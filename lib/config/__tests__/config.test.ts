/**
 * Unit tests for lib/config/schema.ts and lib/config/index.ts
 *
 * Each env var is tested across three outcomes:
 *   1. Valid value → correct parsed output
 *   2. Missing (unset) → default (if optional) or throw (if required)
 *   3. Set but invalid → always throws (never silently falls back)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DatabaseSchema,
  AuthSchema,
  EmailSchema,
  RedisSchema,
  WebhookQueueSchema,
  LlmSchema,
  LoggingSchema,
  SecuritySchema,
  RuntimeSchema,
} from '../schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  return schema.parse(data)
}

function safeParse<T>(schema: { safeParse: (data: unknown) => { success: boolean; error?: unknown } }, data: unknown) {
  return schema.safeParse(data)
}

// ---------------------------------------------------------------------------
// DatabaseSchema
// ---------------------------------------------------------------------------

describe('DatabaseSchema', () => {
  it('accepts a valid URL with the UTC timezone option', () => {
    const result = parse(DatabaseSchema, {
      DATABASE_URL: 'postgresql://localhost:5432/mydb?options=-c%20timezone%3DUTC',
    })
    expect(result.DATABASE_URL).toContain('options=-c%20timezone%3DUTC')
  })

  // The option can be spelled several equivalent ways. Accepting only the
  // %20 form rejects correctly-configured deployments — it broke the whole
  // integration suite, whose harness builds the URL with URLSearchParams and
  // therefore encodes the space as '+'.
  it.each([
    ['+ as the encoded space (URLSearchParams output)', 'postgresql://inbox:test@localhost:5432/inbox_test?schema=public&options=-c+timezone%3DUTC'],
    ['%20 as the encoded space', 'postgresql://localhost:5432/mydb?options=-c%20timezone%3DUTC'],
    ['mixed-case parameter name', 'postgresql://localhost:5432/mydb?options=-c%20TimeZone%3DUTC'],
    ['lower-case utc value', 'postgresql://localhost:5432/mydb?options=-c%20timezone%3Dutc'],
    ['additional -c settings alongside', 'postgresql://localhost:5432/mydb?options=-c%20timezone%3DUTC%20-c%20statement_timeout%3D5000'],
    ['timezone not first among the settings', 'postgresql://localhost:5432/mydb?options=-c%20statement_timeout%3D5000%20-c%20timezone%3DUTC'],
  ])('accepts %s', (_label, url) => {
    expect(safeParse(DatabaseSchema, { DATABASE_URL: url }).success).toBe(true)
  })

  it('rejects a URL missing the UTC timezone option', () => {
    const result = safeParse(DatabaseSchema, {
      DATABASE_URL: 'postgresql://localhost:5432/mydb',
    })
    expect(result.success).toBe(false)
  })

  it.each([
    ['a non-UTC timezone', 'postgresql://localhost:5432/mydb?options=-c%20timezone%3DAmerica%2FNew_York'],
    ['an options param with no timezone setting', 'postgresql://localhost:5432/mydb?options=-c%20statement_timeout%3D5000'],
    ['timezone as a substring of another setting', 'postgresql://localhost:5432/mydb?options=-c%20log_timezone%3DUTC'],
  ])('rejects %s', (_label, url) => {
    expect(safeParse(DatabaseSchema, { DATABASE_URL: url }).success).toBe(false)
  })

  it('rejects a non-URL string', () => {
    const result = safeParse(DatabaseSchema, { DATABASE_URL: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects an absent DATABASE_URL', () => {
    const result = safeParse(DatabaseSchema, { DATABASE_URL: undefined })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AuthSchema
// ---------------------------------------------------------------------------

describe('AuthSchema', () => {
  it('accepts a valid JWT_SECRET', () => {
    const result = parse(AuthSchema, { JWT_SECRET: 'a-very-strong-secret-key-here' })
    expect(result.JWT_SECRET).toBe('a-very-strong-secret-key-here')
  })

  it('rejects a missing JWT_SECRET', () => {
    expect(() => parse(AuthSchema, { JWT_SECRET: undefined })).toThrow()
  })

  it('rejects an empty JWT_SECRET', () => {
    expect(() => parse(AuthSchema, { JWT_SECRET: '' })).toThrow()
  })

  it('rejects a whitespace-only JWT_SECRET (trim reduces to empty)', () => {
    expect(() => parse(AuthSchema, { JWT_SECRET: '   ' })).toThrow()
  })

  it('rejects a JWT_SECRET shorter than 8 characters', () => {
    expect(() => parse(AuthSchema, { JWT_SECRET: 'short' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// EmailSchema
// ---------------------------------------------------------------------------

describe('EmailSchema', () => {
  const valid = {
    AUTH_RESEND_API_KEY: 're_test_key_123456',
    AUTH_EMAIL_FROM: 'noreply@example.com',
    AUTH_EMAIL_FROM_NAME: 'Example',
    WEBHOOK_SECRET: 'a-webhook-secret-12',
  }

  it('accepts all valid fields', () => {
    const result = parse(EmailSchema, valid)
    expect(result.AUTH_EMAIL_FROM).toBe('noreply@example.com')
    expect(result.WEBHOOK_SECRET).toBe('a-webhook-secret-12')
  })

  it('rejects a missing WEBHOOK_SECRET', () => {
    expect(() => parse(EmailSchema, { ...valid, WEBHOOK_SECRET: undefined })).toThrow()
  })

  it('rejects an empty WEBHOOK_SECRET', () => {
    expect(() => parse(EmailSchema, { ...valid, WEBHOOK_SECRET: '' })).toThrow()
  })

  it('rejects an invalid AUTH_EMAIL_FROM', () => {
    expect(() => parse(EmailSchema, { ...valid, AUTH_EMAIL_FROM: 'not-an-email' })).toThrow()
  })

  it('rejects a missing AUTH_RESEND_API_KEY', () => {
    expect(() => parse(EmailSchema, { ...valid, AUTH_RESEND_API_KEY: undefined })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// RedisSchema
// ---------------------------------------------------------------------------

describe('RedisSchema', () => {
  it('accepts a valid redis:// URL', () => {
    const result = parse(RedisSchema, { REDIS_URL: 'redis://myhost:6380' })
    expect(result.REDIS_URL).toBe('redis://myhost:6380')
  })

  it('accepts a rediss:// URL', () => {
    const result = parse(RedisSchema, { REDIS_URL: 'rediss://myhost:6380' })
    expect(result.REDIS_URL).toBe('rediss://myhost:6380')
  })

  it('defaults to redis://localhost:6379 when unset', () => {
    const result = parse(RedisSchema, { REDIS_URL: undefined })
    expect(result.REDIS_URL).toBe('redis://localhost:6379')
  })

  it('rejects a non-URL string', () => {
    const result = safeParse(RedisSchema, { REDIS_URL: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty string (treated as invalid URL)', () => {
    const result = safeParse(RedisSchema, { REDIS_URL: '' })
    // Empty string is not a URL → should fail
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WebhookQueueSchema
// ---------------------------------------------------------------------------

describe('WebhookQueueSchema', () => {
  it('defaults maxRetries to 3 when unset', () => {
    const result = parse(WebhookQueueSchema, {
      WEBHOOK_QUEUE_MAX_RETRIES: undefined,
      WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
    })
    expect(result.WEBHOOK_QUEUE_MAX_RETRIES).toBe(3)
  })

  it('defaults concurrencyPerInbox to 5 when unset', () => {
    const result = parse(WebhookQueueSchema, {
      WEBHOOK_QUEUE_MAX_RETRIES: undefined,
      WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
    })
    expect(result.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX).toBe(5)
  })

  it('parses valid WEBHOOK_QUEUE_MAX_RETRIES', () => {
    const result = parse(WebhookQueueSchema, {
      WEBHOOK_QUEUE_MAX_RETRIES: '7',
      WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
    })
    expect(result.WEBHOOK_QUEUE_MAX_RETRIES).toBe(7)
  })

  it('throws for non-numeric WEBHOOK_QUEUE_MAX_RETRIES (never silently defaults)', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: 'abc',
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
      }),
    ).toThrow()
  })

  it('throws for negative WEBHOOK_QUEUE_MAX_RETRIES', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: '-5',
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
      }),
    ).toThrow()
  })

  it('throws for zero WEBHOOK_QUEUE_MAX_RETRIES', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: '0',
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: undefined,
      }),
    ).toThrow()
  })

  it('throws for non-numeric WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: undefined,
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: 'abc',
      }),
    ).toThrow()
  })

  it('throws for negative WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: undefined,
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: '-1',
      }),
    ).toThrow()
  })

  it('throws for zero WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX', () => {
    expect(() =>
      parse(WebhookQueueSchema, {
        WEBHOOK_QUEUE_MAX_RETRIES: undefined,
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: '0',
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// LlmSchema
// ---------------------------------------------------------------------------

describe('LlmSchema', () => {
  it('accepts valid provider + key', () => {
    const result = parse(LlmSchema, {
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'sk-ant-key',
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.LLM_PROVIDER).toBe('anthropic')
    expect(result.LLM_API_KEY).toBe('sk-ant-key')
  })

  it('accepts ollama without an API key', () => {
    const result = parse(LlmSchema, {
      LLM_PROVIDER: 'ollama',
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.LLM_PROVIDER).toBe('ollama')
  })

  it('accepts all fields undefined (LLM disabled)', () => {
    const result = parse(LlmSchema, {
      LLM_PROVIDER: undefined,
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.LLM_PROVIDER).toBeUndefined()
  })

  it('rejects an unrecognised LLM_PROVIDER (no silent null)', () => {
    const result = safeParse(LlmSchema, {
      LLM_PROVIDER: 'gemini',
      LLM_API_KEY: 'some-key',
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects provider=anthropic without LLM_API_KEY', () => {
    const result = safeParse(LlmSchema, {
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects provider=openai without LLM_API_KEY', () => {
    const result = safeParse(LlmSchema, {
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
      LLM_BASE_URL: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid LLM_BASE_URL', () => {
    const result = safeParse(LlmSchema, {
      LLM_PROVIDER: 'ollama',
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
      LLM_BASE_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LoggingSchema
// ---------------------------------------------------------------------------

describe('LoggingSchema', () => {
  it('accepts a valid LOG_LEVEL', () => {
    const result = parse(LoggingSchema, { NODE_ENV: 'production', LOG_LEVEL: 'warn' })
    expect(result.LOG_LEVEL).toBe('warn')
  })

  it('defaults NODE_ENV to "development" when unset', () => {
    const result = parse(LoggingSchema, { NODE_ENV: undefined, LOG_LEVEL: undefined })
    expect(result.NODE_ENV).toBe('development')
  })

  it('rejects an invalid LOG_LEVEL (e.g. "warning" instead of "warn")', () => {
    const result = safeParse(LoggingSchema, { NODE_ENV: 'production', LOG_LEVEL: 'warning' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid LOG_LEVEL (e.g. "verbose")', () => {
    const result = safeParse(LoggingSchema, { NODE_ENV: 'production', LOG_LEVEL: 'verbose' })
    expect(result.success).toBe(false)
  })

  it('allows LOG_LEVEL to be undefined', () => {
    const result = parse(LoggingSchema, { NODE_ENV: 'production', LOG_LEVEL: undefined })
    expect(result.LOG_LEVEL).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SecuritySchema
// ---------------------------------------------------------------------------

describe('SecuritySchema', () => {
  it('defaults WEBHOOK_ALLOW_PRIVATE_NETWORK to false when unset', () => {
    const result = parse(SecuritySchema, {
      WEBHOOK_EGRESS_ALLOWLIST: undefined,
      WEBHOOK_ALLOW_PRIVATE_NETWORK: undefined,
    })
    expect(result.WEBHOOK_ALLOW_PRIVATE_NETWORK).toBe(false)
  })

  it('accepts WEBHOOK_ALLOW_PRIVATE_NETWORK=true', () => {
    const result = parse(SecuritySchema, {
      WEBHOOK_EGRESS_ALLOWLIST: undefined,
      WEBHOOK_ALLOW_PRIVATE_NETWORK: 'true',
    })
    expect(result.WEBHOOK_ALLOW_PRIVATE_NETWORK).toBe(true)
  })

  it('rejects an invalid WEBHOOK_ALLOW_PRIVATE_NETWORK value', () => {
    const result = safeParse(SecuritySchema, {
      WEBHOOK_EGRESS_ALLOWLIST: undefined,
      WEBHOOK_ALLOW_PRIVATE_NETWORK: 'yes',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an allowlist string', () => {
    const result = parse(SecuritySchema, {
      WEBHOOK_EGRESS_ALLOWLIST: '.example.com',
      WEBHOOK_ALLOW_PRIVATE_NETWORK: undefined,
    })
    expect(result.WEBHOOK_EGRESS_ALLOWLIST).toBe('.example.com')
  })
})

// ---------------------------------------------------------------------------
// RuntimeSchema
// ---------------------------------------------------------------------------

describe('RuntimeSchema', () => {
  it('defaults all booleans to false when unset', () => {
    const result = parse(RuntimeSchema, {
      ENABLE_ASYNC_WEBHOOK_PROCESSING: undefined,
      ENABLE_BILLING: undefined,
      HEALTHZ_SECRET: undefined,
      AUTOMATION_SWEEPER_SECRET: undefined,
    })
    expect(result.ENABLE_ASYNC_WEBHOOK_PROCESSING).toBe(false)
    expect(result.ENABLE_BILLING).toBe(false)
  })

  it('accepts ENABLE_BILLING=true', () => {
    const result = parse(RuntimeSchema, {
      ENABLE_ASYNC_WEBHOOK_PROCESSING: undefined,
      ENABLE_BILLING: 'true',
      HEALTHZ_SECRET: undefined,
      AUTOMATION_SWEEPER_SECRET: undefined,
    })
    expect(result.ENABLE_BILLING).toBe(true)
  })

  it('rejects an invalid boolean value', () => {
    const result = safeParse(RuntimeSchema, {
      ENABLE_ASYNC_WEBHOOK_PROCESSING: 'yes',
      ENABLE_BILLING: undefined,
      HEALTHZ_SECRET: undefined,
      AUTOMATION_SWEEPER_SECRET: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional secrets when set', () => {
    const result = parse(RuntimeSchema, {
      ENABLE_ASYNC_WEBHOOK_PROCESSING: undefined,
      ENABLE_BILLING: undefined,
      HEALTHZ_SECRET: 'a-healthz-secret',
      AUTOMATION_SWEEPER_SECRET: 'a-sweeper-secret',
    })
    expect(result.HEALTHZ_SECRET).toBe('a-healthz-secret')
    expect(result.AUTOMATION_SWEEPER_SECRET).toBe('a-sweeper-secret')
  })
})

// ---------------------------------------------------------------------------
// assertConfig + Secret (via config/index.ts)
// ---------------------------------------------------------------------------

describe('assertConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('throws an aggregated error listing all problems at once', async () => {
    process.env.DATABASE_URL = undefined
    process.env.JWT_SECRET = undefined
    process.env.WEBHOOK_SECRET = undefined
    process.env.AUTH_RESEND_API_KEY = undefined
    process.env.AUTH_EMAIL_FROM = undefined
    process.env.AUTH_EMAIL_FROM_NAME = undefined

    // Reset module cache so we get a fresh import with mutated env
    const { vi } = await import('vitest')
    vi.resetModules()
    const { assertConfig } = await import('../index')

    let caughtError: Error | undefined
    try {
      assertConfig()
    } catch (e) {
      caughtError = e as Error
    }
    expect(caughtError).toBeDefined()
    expect(caughtError!.message).toContain('Configuration errors')
    // Should list multiple problems
    expect(caughtError!.message.split('\n').length).toBeGreaterThan(2)
  })

  it('does not include secret values in error messages', async () => {
    process.env.DATABASE_URL = undefined
    process.env.JWT_SECRET = 'short' // valid format but too short — 5 chars

    const { vi } = await import('vitest')
    vi.resetModules()
    const { assertConfig } = await import('../index')

    let caughtError: Error | undefined
    try {
      assertConfig()
    } catch (e) {
      caughtError = e as Error
    }
    expect(caughtError?.message).not.toContain('short')
  })
})

describe('Secret', () => {
  it('reveal() returns the raw value', async () => {
    const { Secret } = await import('../index')
    const s = new Secret('my-secret')
    expect(s.reveal()).toBe('my-secret')
  })

  it('toString() returns [REDACTED]', async () => {
    const { Secret } = await import('../index')
    const s = new Secret('my-secret')
    expect(s.toString()).toBe('[REDACTED]')
    expect(String(s)).toBe('[REDACTED]')
  })

  it('toJSON() returns [REDACTED]', async () => {
    const { Secret } = await import('../index')
    const s = new Secret('my-secret')
    expect(JSON.stringify({ secret: s })).toBe('{"secret":"[REDACTED]"}')
  })

  it('util.inspect returns [REDACTED]', async () => {
    const { Secret } = await import('../index')
    const { inspect } = await import('node:util')
    const s = new Secret('my-secret')
    expect(inspect(s)).toBe('[REDACTED]')
  })
})
