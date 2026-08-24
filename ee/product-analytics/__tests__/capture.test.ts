import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const captureMock = vi.fn()
const loggerWarnMock = vi.fn()

vi.mock('../client', () => ({
  getPostHogClient: () => ({ capture: (...args: unknown[]) => captureMock(...args) }),
}))
vi.mock('@/lib/logger', () => ({
  default: { warn: (...a: unknown[]) => loggerWarnMock(...a), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('captureEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('disabled (the default)', () => {
    withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

    it('does not construct a PostHog client or call capture', async () => {
      const { captureEvent, PRODUCT_ANALYTICS_EVENTS } = await import('../capture')
      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1', { inboxId: 'inbox_1' })

      expect(captureMock).not.toHaveBeenCalled()
    })
  })

  describe('enabled', () => {
    withConfigEnv({
      ENABLE_PRODUCT_ANALYTICS: 'true',
      POSTHOG_API_KEY: 'phc_test1234567890',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    })

    it('captures the event with the distinct id, event name, and properties', async () => {
      const { captureEvent, PRODUCT_ANALYTICS_EVENTS } = await import('../capture')
      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1', { inboxId: 'inbox_1' })

      expect(captureMock).toHaveBeenCalledWith({
        distinctId: 'user_1',
        event: 'inbox_created',
        properties: { inboxId: 'inbox_1' },
      })
    })

    it('captures an event with no properties', async () => {
      const { captureEvent, PRODUCT_ANALYTICS_EVENTS } = await import('../capture')
      captureEvent(PRODUCT_ANALYTICS_EVENTS.mcpToolCalled, 'user_1')

      expect(captureMock).toHaveBeenCalledWith({
        distinctId: 'user_1',
        event: 'mcp_tool_called',
        properties: undefined,
      })
    })

    it('never throws when the underlying client throws, and logs instead', async () => {
      captureMock.mockImplementation(() => {
        throw new Error('network down')
      })

      const { captureEvent, PRODUCT_ANALYTICS_EVENTS } = await import('../capture')
      expect(() =>
        captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1'),
      ).not.toThrow()

      expect(loggerWarnMock).toHaveBeenCalled()
    })

    it('goes back to a no-op the moment the flag flips off', async () => {
      const { captureEvent, PRODUCT_ANALYTICS_EVENTS } = await import('../capture')
      setConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

      captureEvent(PRODUCT_ANALYTICS_EVENTS.inboxCreated, 'user_1')

      expect(captureMock).not.toHaveBeenCalled()
    })
  })
})
