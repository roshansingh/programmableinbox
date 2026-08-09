import { describe, it, expect } from 'vitest'
import { DOMAIN_SCHEMAS, type DomainName } from '../schema'

/** Parses a raw env slice through one domain's schema. */
function parse<K extends DomainName>(domain: K, env: Record<string, string | undefined>) {
  return DOMAIN_SCHEMAS[domain].schema.parse(env)
}

describe('db schema', () => {
  const UTC_PERCENT = 'postgresql://u:p@h:5432/db?options=-c%20timezone%3DUTC'

  it('accepts a URL carrying the UTC option percent-encoded', () => {
    expect(parse('db', { DATABASE_URL: UTC_PERCENT }).url).toBe(UTC_PERCENT)
  })

  it('accepts the plus-encoded form URLSearchParams produces', () => {
    // test/integration/setup/db-url.ts builds the option with
    // `URLSearchParams.set`, which serialises the space as `+`. A literal
    // substring check for `options=-c%20timezone%3DUTC` would reject this
    // perfectly valid URL, so the check has to be semantic.
    const plus = 'postgresql://u:p@h:5432/db?options=-c+timezone%3DUTC'
    expect(parse('db', { DATABASE_URL: plus }).url).toBe(plus)
  })

  it('accepts a lowercase timezone key with spaces around the equals sign', () => {
    const loose = 'postgresql://u:p@h:5432/db?options=-c%20TimeZone%20%3D%20utc'
    expect(parse('db', { DATABASE_URL: loose }).url).toBe(loose)
  })

  it('rejects a URL with no UTC session timezone', () => {
    expect(() => parse('db', { DATABASE_URL: 'postgresql://u:p@h:5432/db' })).toThrow()
  })

  it('rejects a URL whose session timezone is not UTC', () => {
    expect(() =>
      parse('db', {
        DATABASE_URL: 'postgresql://u:p@h:5432/db?options=-c%20timezone%3DAmerica%2FNew_York',
      }),
    ).toThrow()
  })

  it('rejects a non-postgres protocol', () => {
    expect(() =>
      parse('db', { DATABASE_URL: 'mysql://u:p@h:3306/db?options=-c%20timezone%3DUTC' }),
    ).toThrow()
  })

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parse('db', {})).toThrow()
  })
})

describe('auth schema', () => {
  it('boxes JWT_SECRET so it cannot be serialised', () => {
    const secret = 'a'.repeat(32)
    const parsed = parse('auth', { JWT_SECRET: secret })
    expect(JSON.stringify(parsed)).not.toContain(secret)
    expect(parsed.jwtSecret.reveal()).toBe(secret)
  })

  it('rejects a whitespace-only JWT_SECRET', () => {
    expect(() => parse('auth', { JWT_SECRET: '   ' })).toThrow()
  })

  it('rejects a JWT_SECRET below the minimum length', () => {
    expect(() => parse('auth', { JWT_SECRET: 'short' })).toThrow()
  })
})

describe('email schema', () => {
  const valid = {
    AUTH_RESEND_API_KEY: 're_test',
    AUTH_EMAIL_FROM: 'no-reply@example.com',
    AUTH_EMAIL_FROM_NAME: 'Inbox',
  }

  it('parses a complete configuration', () => {
    const parsed = parse('email', valid)
    expect(parsed.from).toBe('no-reply@example.com')
    expect(parsed.resendApiKey.reveal()).toBe('re_test')
  })

  it('requires the from address', () => {
    expect(() => parse('email', { ...valid, AUTH_EMAIL_FROM: undefined })).toThrow()
  })
})

describe('logging schema', () => {
  it('yields null when LOG_LEVEL is unset, leaving the caller to pick a default', () => {
    expect(parse('logging', {}).level).toBeNull()
  })

  it('accepts a valid level', () => {
    expect(parse('logging', { LOG_LEVEL: 'warn' }).level).toBe('warn')
  })

  it('throws on LOG_LEVEL=warning rather than silently keeping info', () => {
    expect(() => parse('logging', { LOG_LEVEL: 'warning' })).toThrow()
  })
})

describe('redis schema', () => {
  it('yields null when unset — there is no localhost default', () => {
    expect(parse('redis', {}).url).toBeNull()
  })

  it('accepts a rediss:// URL for managed providers', () => {
    expect(parse('redis', { REDIS_URL: 'rediss://user:pw@redis.example.com:6380/1' }).url).toBe(
      'rediss://user:pw@redis.example.com:6380/1',
    )
  })

  it('throws on a malformed REDIS_URL rather than at first connection', () => {
    expect(() => parse('redis', { REDIS_URL: 'not-a-url' })).toThrow()
  })

  it('throws on a non-redis protocol', () => {
    expect(() => parse('redis', { REDIS_URL: 'http://localhost:6379' })).toThrow()
  })
})

describe('webhooks schema', () => {
  const secret = { WEBHOOK_SECRET: 'w'.repeat(16) }

  it('defaults maxRetries to 3 and concurrency to 5 when unset', () => {
    const parsed = parse('webhooks', secret)
    expect(parsed.maxRetries).toBe(3)
    expect(parsed.concurrencyPerInbox).toBe(5)
  })

  it('defaults async processing to disabled', () => {
    expect(parse('webhooks', secret).asyncProcessingEnabled).toBe(false)
  })

  it.each(['abc', 'NaN', '-5', '0', '3.5'])(
    'throws on WEBHOOK_QUEUE_MAX_RETRIES=%s instead of defaulting to 3',
    (raw) => {
      expect(() => parse('webhooks', { ...secret, WEBHOOK_QUEUE_MAX_RETRIES: raw })).toThrow()
    },
  )

  it('throws on an out-of-range WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX', () => {
    expect(() =>
      parse('webhooks', { ...secret, WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: '5000' }),
    ).toThrow()
  })

  it('accepts the documented boolean spellings for async processing', () => {
    expect(parse('webhooks', { ...secret, ENABLE_ASYNC_WEBHOOK_PROCESSING: 'TRUE' })
      .asyncProcessingEnabled).toBe(true)
    expect(parse('webhooks', { ...secret, ENABLE_ASYNC_WEBHOOK_PROCESSING: '1' })
      .asyncProcessingEnabled).toBe(true)
  })

  it('throws on an unrecognised boolean instead of reading it as false', () => {
    expect(() =>
      parse('webhooks', { ...secret, ENABLE_ASYNC_WEBHOOK_PROCESSING: 'enabled' }),
    ).toThrow()
  })

  it('requires WEBHOOK_SECRET', () => {
    expect(() => parse('webhooks', {})).toThrow()
  })
})

describe('llm schema', () => {
  it('is disabled when no provider is configured', () => {
    expect(parse('llm', {}).provider).toBeNull()
  })

  it('throws on an unrecognised LLM_PROVIDER rather than disabling silently', () => {
    expect(() => parse('llm', { LLM_PROVIDER: 'anthropik' })).toThrow()
  })

  it('requires LLM_API_KEY when a hosted provider is set', () => {
    expect(() => parse('llm', { LLM_PROVIDER: 'anthropic' })).toThrow(/LLM_API_KEY/)
  })

  it('does not require LLM_API_KEY for ollama, which runs locally', () => {
    expect(parse('llm', { LLM_PROVIDER: 'ollama' }).provider).toBe('ollama')
  })

  it('boxes the api key', () => {
    const parsed = parse('llm', { LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-secret' })
    expect(JSON.stringify(parsed)).not.toContain('sk-secret')
    expect(parsed.apiKey?.reveal()).toBe('sk-secret')
  })

  it('rejects a malformed LLM_BASE_URL', () => {
    expect(() =>
      parse('llm', { LLM_PROVIDER: 'ollama', LLM_BASE_URL: 'localhost:11434' }),
    ).toThrow()
  })
})

describe('security schema', () => {
  it('parses WEBHOOK_EGRESS_ALLOWLIST into trimmed entries', () => {
    const parsed = parse('security', {
      WEBHOOK_EGRESS_ALLOWLIST: 'hooks.example.com, .partner.io',
    })
    expect(parsed.egressAllowlist).toEqual(['hooks.example.com', '.partner.io'])
  })

  it('yields null when the allowlist is unset', () => {
    expect(parse('security', {}).egressAllowlist).toBeNull()
  })

  it('yields null for an allowlist of only separators', () => {
    expect(parse('security', { WEBHOOK_EGRESS_ALLOWLIST: ' , , ' }).egressAllowlist).toBeNull()
  })

  it('defaults allowPrivateNetwork to false', () => {
    expect(parse('security', {}).allowPrivateNetwork).toBe(false)
  })

  it('rejects a non-boolean WEBHOOK_ALLOW_PRIVATE_NETWORK', () => {
    expect(() => parse('security', { WEBHOOK_ALLOW_PRIVATE_NETWORK: 'sure' })).toThrow()
  })

  it('boxes the operational secrets', () => {
    const parsed = parse('security', {
      HEALTHZ_SECRET: 'hz-secret',
      AUTOMATION_SWEEPER_SECRET: 'sweep-secret',
    })
    expect(JSON.stringify(parsed)).not.toContain('hz-secret')
    expect(parsed.healthzSecret?.reveal()).toBe('hz-secret')
    expect(parsed.automationSweeperSecret?.reveal()).toBe('sweep-secret')
  })

  it('leaves the operational secrets null when unset', () => {
    const parsed = parse('security', {})
    expect(parsed.healthzSecret).toBeNull()
    expect(parsed.automationSweeperSecret).toBeNull()
  })
})

describe('runtime schema', () => {
  it('defaults to development', () => {
    expect(parse('runtime', {}).nodeEnv).toBe('development')
    expect(parse('runtime', {}).isProduction).toBe(false)
  })

  it('recognises production', () => {
    expect(parse('runtime', { NODE_ENV: 'production' }).isProduction).toBe(true)
  })

  it('rejects an unrecognised NODE_ENV', () => {
    expect(() => parse('runtime', { NODE_ENV: 'staging' })).toThrow()
  })
})

describe('commercial schema', () => {
  it('defaults to disabled', () => {
    expect(parse('commercial', {}).enabled).toBe(false)
  })

  it('enables on any documented truthy spelling', () => {
    expect(parse('commercial', { USE_COMMERCIAL: 'yes' }).enabled).toBe(true)
  })

  it('rejects a set-but-malformed value rather than falling back to false', () => {
    expect(() => parse('commercial', { USE_COMMERCIAL: 'perhaps' })).toThrow()
  })

  // The rename from ENABLE_BILLING is deliberately breaking, on the
  // EMAIL_VERIFICATION_SECRET -> EMAIL_LINK_SECRET precedent: a deployment
  // still setting the old name must not silently start with enforcement off.
  // DOMAIN_SCHEMAS is the authoritative variable list, so the absence of
  // ENABLE_BILLING there is what makes assertConfig() report the new name.
  it('no longer recognises ENABLE_BILLING anywhere in the registry', () => {
    const all = Object.values(DOMAIN_SCHEMAS).flatMap((d) => d.vars as readonly string[])
    expect(all).not.toContain('ENABLE_BILLING')
    expect(all).toContain('USE_COMMERCIAL')
  })
})

describe('DOMAIN_SCHEMAS registry', () => {
  it('lists every variable a domain reads, with no duplicates across domains', () => {
    const all = Object.values(DOMAIN_SCHEMAS).flatMap((d) => d.vars as readonly string[])
    expect(new Set(all).size).toBe(all.length)
  })
})
