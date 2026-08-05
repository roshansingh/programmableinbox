import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * The `mcp` domain (issue #104).
 *
 * `MCP_ALLOWED_ORIGINS` is the DNS-rebinding allowlist, and the reason these
 * exist: an entry that is not a comparable origin used to be dropped silently,
 * which meant `MCP_ALLOWED_ORIGINS=app.example.com` parsed, contributed
 * nothing, and 403'd every browser request it was written to admit — with no
 * error anywhere naming the variable. That is the "set but malformed → silent
 * fallback" failure the config contract exists to prevent.
 */
const VARS = [
  'ENABLE_MCP',
  'MCP_ALLOWED_ORIGINS',
  'MCP_RATE_LIMIT_MAX',
  'MCP_RATE_LIMIT_WINDOW_S',
] as const

const ORIGINAL = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

function withEnv(values: Partial<Record<(typeof VARS)[number], string | undefined>>) {
  for (const name of VARS) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
  return parseDomain('mcp')
}

afterEach(() => {
  for (const name of VARS) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
})

describe('mcp config domain', () => {
  it('is off with no allowlist by default', () => {
    const config = withEnv({})
    expect(config.enabled).toBe(false)
    expect(config.allowedOrigins).toEqual([])
    expect(config.rateLimitMax).toBe(120)
    expect(config.rateLimitWindowS).toBe(60)
  })

  it('parses a single origin', () => {
    expect(withEnv({ MCP_ALLOWED_ORIGINS: 'https://app.example.com' }).allowedOrigins).toEqual([
      'https://app.example.com',
    ])
  })

  it('splits on commas and trims', () => {
    expect(
      withEnv({ MCP_ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com ' })
        .allowedOrigins,
    ).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('canonicalises, so a trailing slash or default port matches what a browser sends', () => {
    expect(
      withEnv({ MCP_ALLOWED_ORIGINS: 'https://app.example.com/,https://b.example.com:443' })
        .allowedOrigins,
    ).toEqual(['https://app.example.com', 'https://b.example.com'])
  })

  it('keeps a non-default port, which is part of the origin', () => {
    expect(withEnv({ MCP_ALLOWED_ORIGINS: 'http://localhost:4000' }).allowedOrigins).toEqual([
      'http://localhost:4000',
    ])
  })

  it('de-duplicates entries that canonicalise to the same origin', () => {
    expect(
      withEnv({ MCP_ALLOWED_ORIGINS: 'https://app.example.com,https://app.example.com/' })
        .allowedOrigins,
    ).toEqual(['https://app.example.com'])
  })

  it('treats a blank value as unset rather than invalid', () => {
    expect(withEnv({ MCP_ALLOWED_ORIGINS: '   ' }).allowedOrigins).toEqual([])
  })

  it('ignores empty entries between commas', () => {
    expect(
      withEnv({ MCP_ALLOWED_ORIGINS: 'https://a.example.com,,https://b.example.com' })
        .allowedOrigins,
    ).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  describe('rejects a value that is not a comparable origin', () => {
    it('throws on a bare host with no scheme', () => {
      // The motivating case: parses as nothing, would have been dropped.
      expect(() => withEnv({ MCP_ALLOWED_ORIGINS: 'app.example.com' })).toThrow(ConfigError)
    })

    it('throws on a host:port with no scheme', () => {
      // `new URL('localhost:4000')` SUCCEEDS, yielding protocol `localhost:`
      // and an empty host — which is why the check cannot just be try/catch.
      expect(() => withEnv({ MCP_ALLOWED_ORIGINS: 'localhost:4000' })).toThrow(ConfigError)
    })

    it('throws on a scheme with no well-defined origin', () => {
      // Non-special schemes serialise their origin as the string "null", so
      // they can never match; allowlisting one is a request we cannot honor.
      expect(() => withEnv({ MCP_ALLOWED_ORIGINS: 'chrome-extension://abcdef' })).toThrow(
        ConfigError,
      )
    })

    it('throws on the literal null origin', () => {
      expect(() => withEnv({ MCP_ALLOWED_ORIGINS: 'null' })).toThrow(ConfigError)
    })

    it('rejects the whole list rather than admitting the valid part', () => {
      expect(() =>
        withEnv({ MCP_ALLOWED_ORIGINS: 'https://good.example.com,app.example.com' }),
      ).toThrow(ConfigError)
    })

    it('names the variable and every offending entry, and suggests the shape', () => {
      try {
        withEnv({ MCP_ALLOWED_ORIGINS: 'app.example.com,localhost:4000' })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        const { message, variables } = error as ConfigError
        expect(variables).toContain('MCP_ALLOWED_ORIGINS')
        expect(message).toContain('app.example.com')
        expect(message).toContain('localhost:4000')
        expect(message).toContain('https://app.example.com')
      }
    })
  })

  describe('the rest of the domain', () => {
    it('reads the flag and the limiter bounds', () => {
      const config = withEnv({
        ENABLE_MCP: 'true',
        MCP_RATE_LIMIT_MAX: '7',
        MCP_RATE_LIMIT_WINDOW_S: '30',
      })
      expect(config.enabled).toBe(true)
      expect(config.rateLimitMax).toBe(7)
      expect(config.rateLimitWindowS).toBe(30)
    })

    it('throws on a malformed flag rather than reading it as off', () => {
      expect(() => withEnv({ ENABLE_MCP: 'yes-please' })).toThrow(ConfigError)
    })

    it('throws on a non-integer limit rather than falling back to the default', () => {
      expect(() => withEnv({ MCP_RATE_LIMIT_MAX: 'abc' })).toThrow(ConfigError)
      expect(() => withEnv({ MCP_RATE_LIMIT_WINDOW_S: '0' })).toThrow(ConfigError)
    })
  })
})
