import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * The `productAnalytics` domain: EE-only PostHog instrumentation (issue #152).
 * `ENABLE_PRODUCT_ANALYTICS` is inert on a Community build regardless of this
 * schema's validation — the wiring that reads `config.productAnalytics` lives
 * entirely in `ee/product-analytics/`, which `scripts/foss.mjs` deletes. This
 * schema exists so a misconfigured EE deployment fails at boot naming the
 * variable, same as every other conditionally-required flag in this file
 * (see `schema-observability.test.ts`, the direct model for this one).
 */
const VARS = ['ENABLE_PRODUCT_ANALYTICS', 'POSTHOG_API_KEY', 'POSTHOG_HOST'] as const

const ORIGINAL = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

function withEnv(values: Partial<Record<(typeof VARS)[number], string | undefined>>) {
  for (const name of VARS) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
  return parseDomain('productAnalytics')
}

afterEach(() => {
  for (const name of VARS) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
})

describe('productAnalytics config domain', () => {
  it('is off by default, with no key/host required', () => {
    const config = withEnv({})
    expect(config.enabled).toBe(false)
    expect(config.apiKey).toBeNull()
    expect(config.host).toBeNull()
  })

  it('parses a complete configuration', () => {
    const config = withEnv({
      ENABLE_PRODUCT_ANALYTICS: 'true',
      POSTHOG_API_KEY: 'phc_test1234567890',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    })
    expect(config.enabled).toBe(true)
    expect(config.apiKey).toBe('phc_test1234567890')
    expect(config.host).toBe('https://us.i.posthog.com')
  })

  it('throws on a malformed flag rather than reading it as off', () => {
    expect(() => withEnv({ ENABLE_PRODUCT_ANALYTICS: 'yes-please' })).toThrow(ConfigError)
  })

  describe('requirements when enabled', () => {
    it('requires POSTHOG_API_KEY', () => {
      expect(() =>
        withEnv({
          ENABLE_PRODUCT_ANALYTICS: 'true',
          POSTHOG_HOST: 'https://us.i.posthog.com',
        }),
      ).toThrow(ConfigError)
    })

    it('requires POSTHOG_HOST', () => {
      expect(() =>
        withEnv({
          ENABLE_PRODUCT_ANALYTICS: 'true',
          POSTHOG_API_KEY: 'phc_test1234567890',
        }),
      ).toThrow(ConfigError)
    })

    it('names both variables when both are missing', () => {
      try {
        withEnv({ ENABLE_PRODUCT_ANALYTICS: 'true' })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        const { variables } = error as ConfigError
        expect(variables).toContain('POSTHOG_API_KEY')
        expect(variables).toContain('POSTHOG_HOST')
      }
    })

    it('rejects a non-URL host', () => {
      expect(() =>
        withEnv({
          ENABLE_PRODUCT_ANALYTICS: 'true',
          POSTHOG_API_KEY: 'phc_test1234567890',
          POSTHOG_HOST: 'not-a-url',
        }),
      ).toThrow(ConfigError)
    })

    it('does not demand key/host while the flag is off', () => {
      const config = withEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })
      expect(config.apiKey).toBeNull()
      expect(config.host).toBeNull()
    })
  })

  describe('POSTHOG_API_KEY prefix', () => {
    it('rejects a Personal API Key (phx_...) even while the flag is off', () => {
      // Checked regardless of ENABLE_PRODUCT_ANALYTICS: this value is
      // published to every authenticated user via AppConfig the moment it's
      // set, whether or not capture is currently enabled.
      expect(() => withEnv({ POSTHOG_API_KEY: 'phx_admin_scoped_key' })).toThrow(ConfigError)
    })

    it('rejects a Personal API Key when enabling', () => {
      expect(() =>
        withEnv({
          ENABLE_PRODUCT_ANALYTICS: 'true',
          POSTHOG_API_KEY: 'phx_admin_scoped_key',
          POSTHOG_HOST: 'https://us.i.posthog.com',
        }),
      ).toThrow(ConfigError)
    })

    it('accepts a project key (phc_...)', () => {
      const config = withEnv({
        ENABLE_PRODUCT_ANALYTICS: 'true',
        POSTHOG_API_KEY: 'phc_test1234567890',
        POSTHOG_HOST: 'https://us.i.posthog.com',
      })
      expect(config.apiKey).toBe('phc_test1234567890')
    })
  })
})
