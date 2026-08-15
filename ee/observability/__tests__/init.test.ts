import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const registerOTelMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock('@vercel/otel', () => ({ registerOTel: (...a: unknown[]) => registerOTelMock(...a) }))
vi.mock('@/lib/logger', () => ({
  default: { info: (...a: unknown[]) => loggerInfoMock(...a), warn: vi.fn(), error: vi.fn() },
}))

describe('initializeObservability', () => {
  withConfigEnv({
    ENABLE_OBSERVABILITY: 'true',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway.example.com/otlp',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('registers OTel tracing when enabled', async () => {
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).toHaveBeenCalledWith('inboxui')
    expect(loggerInfoMock).toHaveBeenCalled()
  })

  it('uses OTEL_SERVICE_NAME when set', async () => {
    setConfigEnv({ OTEL_SERVICE_NAME: 'my-inboxui' })
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).toHaveBeenCalledWith('my-inboxui')
  })

  it('does nothing when the flag is off', async () => {
    setConfigEnv({ ENABLE_OBSERVABILITY: 'false' })
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).not.toHaveBeenCalled()
    expect(loggerInfoMock).not.toHaveBeenCalled()
  })
})
