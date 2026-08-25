import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '@/components/auth-provider'
import { server } from '@/test/mocks/server'
import { mockUser, mockOrganization, mockAppConfig } from '@/test/mocks/fixtures/users'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

const identifyMock = vi.fn()
const groupMock = vi.fn()

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    identify: (...args: unknown[]) => identifyMock(...args),
    group: (...args: unknown[]) => groupMock(...args),
  },
}))

/**
 * `posthog.identify`/`posthog.group` inside `AuthProvider`'s `refreshUser`
 * success branch (issue #152). `organizationId` and `plan` are the same
 * values `AuthContext` already derives from `user.organizations[0]`.
 */
describe('AuthProvider product-analytics identify/group', () => {
  beforeEach(() => {
    setMockSessionCookie()
    identifyMock.mockClear()
    groupMock.mockClear()
  })

  function serveUser(overrides: {
    productAnalyticsEnabled?: boolean
    organizations?: typeof mockUser.organizations
  }) {
    server.use(
      http.get('http://localhost:4000/api/app/auth/me', () =>
        HttpResponse.json({
          data: {
            ...mockUser,
            organizations: overrides.organizations ?? mockUser.organizations,
            config: {
              ...mockAppConfig,
              productAnalyticsEnabled: overrides.productAnalyticsEnabled ?? false,
            },
          },
        }),
      ),
    )
  }

  it('does not identify or group when product analytics is disabled', async () => {
    serveUser({ productAnalyticsEnabled: false })

    renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => {
      expect(identifyMock).not.toHaveBeenCalled()
      expect(groupMock).not.toHaveBeenCalled()
    })
  })

  it('identifies the user and groups the organization by plan when enabled', async () => {
    serveUser({
      productAnalyticsEnabled: true,
      organizations: [{ ...mockOrganization, plan: { code: 'pro', name: 'Pro', limits: {} as never } }],
    })

    renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => {
      expect(identifyMock).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({ email: mockUser.email }))
    })
    expect(groupMock).toHaveBeenCalledWith('organization', mockOrganization.id, { plan: 'pro' })
  })

  it('groups with an undefined plan on a self-hosted deployment (no plan on the organization)', async () => {
    serveUser({ productAnalyticsEnabled: true, organizations: [mockOrganization] })

    renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => {
      expect(groupMock).toHaveBeenCalledWith('organization', mockOrganization.id, { plan: undefined })
    })
  })

  /**
   * Regression test: identify/group must not be able to undo the
   * setUser/setIsAuthenticated calls that just ran. This was a real bug
   * during development — an unguarded posthog.identify() that threw (e.g.
   * because the mocked module in a different test only stubbed `.init`)
   * fell into refreshUser's outer catch and silently logged the user out.
   */
  it('stays authenticated even if posthog.identify throws', async () => {
    identifyMock.mockImplementation(() => {
      throw new Error('posthog blocked by an extension')
    })
    serveUser({ productAnalyticsEnabled: true })

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
    })
    expect(result.current.user).not.toBeNull()
  })
})
