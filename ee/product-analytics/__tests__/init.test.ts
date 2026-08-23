import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const getPostHogClientMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock('../client', () => ({
  getPostHogClient: (...a: unknown[]) => getPostHogClientMock(...a),
}))
vi.mock('@/lib/logger', () => ({
  default: { info: (...a: unknown[]) => loggerInfoMock(...a), warn: vi.fn(), error: vi.fn() },
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
  })

  describe('disabled (the default)', () => {
    withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

    it('does nothing when the flag is off', async () => {
      const { initializeProductAnalytics } = await import('../init')
      initializeProductAnalytics()

      expect(getPostHogClientMock).not.toHaveBeenCalled()
      expect(loggerInfoMock).not.toHaveBeenCalled()
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
