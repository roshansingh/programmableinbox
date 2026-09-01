import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, waitFor } from '@/test/test-utils'
import { ProductAnalyticsProvider } from '@/components/product-analytics-provider'
import { server } from '@/test/mocks/server'
import { mockUser, mockAppConfig } from '@/test/mocks/fixtures/users'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

const initMock = vi.fn()

vi.mock('posthog-js', () => ({
  default: { init: (...args: unknown[]) => initMock(...args), identify: vi.fn(), group: vi.fn() },
}))

function serveConfig(overrides: {
  productAnalyticsEnabled?: boolean
  posthogApiKey?: string | null
  posthogHost?: string | null
}) {
  server.use(
    http.get('http://localhost:4000/api/app/auth/me', () =>
      HttpResponse.json({
        data: {
          ...mockUser,
          config: {
            ...mockAppConfig,
            productAnalyticsEnabled: overrides.productAnalyticsEnabled ?? false,
            posthogApiKey: overrides.posthogApiKey ?? null,
            posthogHost: overrides.posthogHost ?? null,
          },
        },
      }),
    ),
  )
}

describe('ProductAnalyticsProvider', () => {
  beforeEach(() => {
    setMockSessionCookie()
    initMock.mockClear()
  })

  it('does not call posthog.init when product analytics is disabled', async () => {
    serveConfig({ productAnalyticsEnabled: false })

    render(<ProductAnalyticsProvider />)

    await waitFor(() => {
      expect(initMock).not.toHaveBeenCalled()
    })
  })

  it('calls posthog.init with the project key, host, and masking options when enabled', async () => {
    serveConfig({
      productAnalyticsEnabled: true,
      posthogApiKey: 'phc_test1234567890',
      posthogHost: 'https://us.i.posthog.com',
    })

    render(<ProductAnalyticsProvider />)

    await waitFor(() => {
      expect(initMock).toHaveBeenCalledWith(
        'phc_test1234567890',
        expect.objectContaining({
          api_host: 'https://us.i.posthog.com',
          autocapture: true,
          capture_exceptions: true,
          session_recording: expect.objectContaining({ maskAllInputs: true }),
        }),
      )
    })
  })

  it('does not init when enabled but the key/host have not arrived yet', async () => {
    serveConfig({ productAnalyticsEnabled: true, posthogApiKey: null, posthogHost: null })

    render(<ProductAnalyticsProvider />)

    await waitFor(() => {
      expect(initMock).not.toHaveBeenCalled()
    })
  })

  it('renders nothing', async () => {
    serveConfig({ productAnalyticsEnabled: false })

    const { container } = render(<ProductAnalyticsProvider />)

    expect(container.textContent).toBe('')
  })
})
