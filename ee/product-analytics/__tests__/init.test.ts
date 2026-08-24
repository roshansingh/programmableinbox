import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const getPostHogClientMock = vi.fn()
const loggerInfoMock = vi.fn()
const registerProductAnalyticsCaptureMock = vi.fn()

vi.mock('../client', () => ({
  getPostHogClient: (...a: unknown[]) => getPostHogClientMock(...a),
}))
vi.mock('@/lib/logger', () => ({
  default: { info: (...a: unknown[]) => loggerInfoMock(...a), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/product-analytics/capture', () => ({
  registerProductAnalyticsCapture: (...a: unknown[]) => registerProductAnalyticsCaptureMock(...a),
  // `../capture` (real, unmocked here) re-exports this from the facade —
  // stubbed just enough to keep that import satisfied.
  PRODUCT_ANALYTICS_EVENTS: { inboxCreated: 'inbox_created' },
}))

describe('initializeProductAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('enabled', () => {
    withConfigEnv({
      ENABLE_PRODUCT_ANALYTICS: 'true',
      POSTHOG_API_KEY: 'phc_test1234567890',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    })

    it('constructs the PostHog client and logs', async () => {
      const { initializeProductAnalytics } = await import('../init')
      initializeProductAnalytics()

      expect(getPostHogClientMock).toHaveBeenCalled()
      expect(loggerInfoMock).toHaveBeenCalled()
    })

    it('registers its captureEvent into the Community facade', async () => {
      const { initializeProductAnalytics } = await import('../init')
      const { captureEvent } = await import('../capture')
      initializeProductAnalytics()

      expect(registerProductAnalyticsCaptureMock).toHaveBeenCalledWith(captureEvent)
    })
  })

  describe('disabled (the default)', () => {
    withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

    it('does nothing when the flag is off', async () => {
      const { initializeProductAnalytics } = await import('../init')
      initializeProductAnalytics()

      expect(getPostHogClientMock).not.toHaveBeenCalled()
      expect(loggerInfoMock).not.toHaveBeenCalled()
    })

    it('still registers captureEvent into the facade — the delegate no-ops on its own', async () => {
      const { initializeProductAnalytics } = await import('../init')
      const { captureEvent } = await import('../capture')
      initializeProductAnalytics()

      expect(registerProductAnalyticsCaptureMock).toHaveBeenCalledWith(captureEvent)
    })

    it('does nothing at all — no client construction, no log line — when unset entirely', async () => {
      setConfigEnv({
        ENABLE_PRODUCT_ANALYTICS: undefined,
        POSTHOG_API_KEY: undefined,
        POSTHOG_HOST: undefined,
      })

      const { initializeProductAnalytics } = await import('../init')
      initializeProductAnalytics()

      expect(getPostHogClientMock).not.toHaveBeenCalled()
      expect(loggerInfoMock).not.toHaveBeenCalled()
    })
  })
})
