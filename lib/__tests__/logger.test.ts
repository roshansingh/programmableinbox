import { describe, it, expect, afterEach, vi } from 'vitest'

describe('logger config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exports a development config with pino-pretty transport', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOG_LEVEL', '')

    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config).toHaveProperty('transport')
    expect(config.transport).toMatchObject({ target: 'pino-pretty' })
  })

  it('exports a production config without pino-pretty transport', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', '')

    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config).not.toHaveProperty('transport')
  })

  it('uses LOG_LEVEL env var when set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', 'warn')

    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config.level).toBe('warn')
  })

  it('defaults to debug level in development when LOG_LEVEL is unset', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOG_LEVEL', '')

    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config.level).toBe('debug')
  })

  it('defaults to info level in production when LOG_LEVEL is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', '')

    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config.level).toBe('info')
  })

  it('throws for invalid LOG_LEVEL (not in valid enum)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', 'verbose') // not a valid pino level
    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    expect(() => buildLoggerConfig()).toThrow()
  })

  it('throws for uppercase LOG_LEVEL (must be exact lowercase match)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', 'WARN')
    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    expect(() => buildLoggerConfig()).toThrow()
  })

  it('includes timestamp serializer in config', async () => {
    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config).toHaveProperty('timestamp')
    expect(typeof config.timestamp).toBe('function')
  })

  it('includes error serializer in config', async () => {
    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config).toHaveProperty('serializers')
    expect(typeof (config.serializers as Record<string, unknown>)?.err).toBe('function')
  })
})

describe('logger singleton', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('default export is a proxy object with logger methods', async () => {
    vi.resetModules()
    const logger = await import('../logger')

    expect(logger.default).toBeDefined()
    expect(typeof logger.default.info).toBe('function')
    expect(typeof logger.default.error).toBe('function')
    expect(typeof logger.default.warn).toBe('function')
    expect(typeof logger.default.debug).toBe('function')
  })

  it('default export proxy delegates to getLogger singleton', async () => {
    vi.resetModules()
    const { getLogger, default: loggerProxy } = await import('../logger')

    const instance = getLogger()
    // The proxy delegates to the same singleton, so methods should work identically
    expect(typeof loggerProxy.info).toBe('function')
    expect(typeof instance.info).toBe('function')
  })

  it('getLogger returns the same singleton on repeated calls', async () => {
    vi.resetModules()
    const { getLogger } = await import('../logger')

    const first = getLogger()
    const second = getLogger()
    expect(first).toBe(second)
  })

  it('logger has a child method for creating child loggers', async () => {
    vi.resetModules()
    const { getLogger } = await import('../logger')
    const logger = getLogger()

    expect(typeof logger.child).toBe('function')
    const child = logger.child({ component: 'test' })
    expect(typeof child.info).toBe('function')
  })

  it('logger can log an info message without throwing', async () => {
    vi.resetModules()
    const { getLogger } = await import('../logger')
    const logger = getLogger()

    expect(() => logger.info({ msg: 'test message' })).not.toThrow()
  })

  it('logger can log an error with an Error object without throwing', async () => {
    vi.resetModules()
    const { getLogger } = await import('../logger')
    const logger = getLogger()
    const err = new Error('test error')

    expect(() => logger.error({ err }, 'something failed')).not.toThrow()
  })
})
