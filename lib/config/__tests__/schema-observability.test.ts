import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * The `observability` domain: EE-only log shipping and tracing (see
 * docs/architecture/observability.md). `ENABLE_OBSERVABILITY` is inert on a
 * Community build regardless of this schema's validation — the wiring that
 * reads `config.observability` lives entirely in `ee/observability/`, which
 * `scripts/foss.mjs` deletes. This schema exists so a misconfigured EE
 * deployment fails at boot naming the variable, same as every other
 * conditionally-required flag in this file.
 */
const VARS = [
  'ENABLE_OBSERVABILITY',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
] as const

const ORIGINAL = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

function withEnv(values: Partial<Record<(typeof VARS)[number], string | undefined>>) {
  for (const name of VARS) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
  return parseDomain('observability')
}

afterEach(() => {
  for (const name of VARS) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
})

describe('observability config domain', () => {
  it('is off by default, with no endpoint/headers required', () => {
    const config = withEnv({})
    expect(config.enabled).toBe(false)
    expect(config.otlpEndpoint).toBeNull()
    expect(config.otlpHeaders).toBeNull()
    expect(config.serviceName).toBe('inboxui')
  })

  it('parses a complete configuration', () => {
    const config = withEnv({
      ENABLE_OBSERVABILITY: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
    })
    expect(config.enabled).toBe(true)
    expect(config.otlpEndpoint).toBe('https://otlp-gateway-prod-us-east-0.grafana.net/otlp')
    expect(config.otlpHeaders?.reveal()).toBe('Authorization=Basic dGVzdDp0ZXN0')
  })

  it('boxes OTEL_EXPORTER_OTLP_HEADERS so it cannot be logged by accident', () => {
    const config = withEnv({
      ENABLE_OBSERVABILITY: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
    })
    expect(String(config.otlpHeaders)).toBe('[redacted]')
    expect(JSON.stringify(config.otlpHeaders)).toBe('"[redacted]"')
  })

  it('defaults serviceName to inboxui when unset', () => {
    expect(withEnv({}).serviceName).toBe('inboxui')
  })

  it('reads OTEL_SERVICE_NAME when set', () => {
    expect(withEnv({ OTEL_SERVICE_NAME: 'my-inboxui' }).serviceName).toBe('my-inboxui')
  })

  it('throws on a malformed flag rather than reading it as off', () => {
    expect(() => withEnv({ ENABLE_OBSERVABILITY: 'yes-please' })).toThrow(ConfigError)
  })

  describe('requirements when enabled', () => {
    it('requires OTEL_EXPORTER_OTLP_ENDPOINT', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
        }),
      ).toThrow(ConfigError)
    })

    it('requires OTEL_EXPORTER_OTLP_HEADERS', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
        }),
      ).toThrow(ConfigError)
    })

    it('names both variables when both are missing', () => {
      try {
        withEnv({ ENABLE_OBSERVABILITY: 'true' })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        const { variables } = error as ConfigError
        expect(variables).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
        expect(variables).toContain('OTEL_EXPORTER_OTLP_HEADERS')
      }
    })

    it('rejects a non-URL endpoint', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
        }),
      ).toThrow(ConfigError)
    })

    it('does not demand endpoint/headers while the flag is off', () => {
      const config = withEnv({ ENABLE_OBSERVABILITY: 'false' })
      expect(config.otlpEndpoint).toBeNull()
      expect(config.otlpHeaders).toBeNull()
    })
  })
})
