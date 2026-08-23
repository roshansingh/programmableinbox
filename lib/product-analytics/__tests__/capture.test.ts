import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerWarnMock = vi.fn()

vi.mock('@/lib/logger', () => ({
  default: { warn: (...a: unknown[]) => loggerWarnMock(...a), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('captureEvent (Community facade)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('is a no-op when nothing has registered an implementation — the FOSS build state', async () => {
    const { captureEvent, PRODUCT_ANALYTICS_EVENTS, resetProductAnalyticsCapture } = await import(
      '../capture'
    )
    resetProductAnalyticsCapture()

    expect(() =>
      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1', { inboxId: 'inbox_1' }),
    ).not.toThrow()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  describe('once a delegate is registered', () => {
    afterEach(async () => {
      const { resetProductAnalyticsCapture } = await import('../capture')
      resetProductAnalyticsCapture()
    })

    it('forwards the event, distinct id, and properties to the registered delegate', async () => {
      const { captureEvent, registerProductAnalyticsCapture, PRODUCT_ANALYTICS_EVENTS } =
        await import('../capture')
      const delegate = vi.fn()
      registerProductAnalyticsCapture(delegate)

      captureEvent(PRODUCT_ANALYTICS_EVENTS.automationCreated, 'user_1', { automationId: 'a1' })

      expect(delegate).toHaveBeenCalledWith('automation_created', 'user_1', {
        automationId: 'a1',
      })
    })

    it('never throws when the registered delegate throws, and logs instead', async () => {
      const { captureEvent, registerProductAnalyticsCapture, PRODUCT_ANALYTICS_EVENTS } =
        await import('../capture')
      registerProductAnalyticsCapture(() => {
        throw new Error('posthog down')
      })

      expect(() => captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1')).not.toThrow()
      expect(loggerWarnMock).toHaveBeenCalled()
    })

    it('goes back to a no-op after resetProductAnalyticsCapture', async () => {
      const {
        captureEvent,
        registerProductAnalyticsCapture,
        resetProductAnalyticsCapture,
        PRODUCT_ANALYTICS_EVENTS,
      } = await import('../capture')
      const delegate = vi.fn()
      registerProductAnalyticsCapture(delegate)
      resetProductAnalyticsCapture()

      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1')

      expect(delegate).not.toHaveBeenCalled()
    })
  })
})
