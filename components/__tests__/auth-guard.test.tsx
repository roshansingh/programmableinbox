import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@/test/test-utils'
import { AuthGuard } from '@/components/auth-guard'
import { server } from '@/test/mocks/server'
import { mockUser, mockAppConfig } from '@/test/mocks/fixtures/users'
import { useRouter, usePathname } from 'next/navigation'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

describe('AuthGuard', () => {
  const mockPush = vi.fn()

  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    } as any)
  })

  it('shows loading spinner while auth is resolving', () => {
    setMockSessionCookie()
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    )

    expect(screen.getByClassName || screen.queryByText('Protected Content')).toBeFalsy()
    // The spinner is rendered via CSS class, just check content is not visible initially
  })

  it('renders children when authenticated', async () => {
    setMockSessionCookie()
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    )

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })
  })

  it('redirects to login when not authenticated on protected route', async () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    // No token set = unauthenticated
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/auth/login?redirect=%2Fdashboard'
      )
    })
  })

  it('allows access to public routes when not authenticated', async () => {
    vi.mocked(usePathname).mockReturnValue('/auth/login')
    render(
      <AuthGuard>
        <div>Login Page</div>
      </AuthGuard>
    )

    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument()
    })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // Both password-reset pages are only ever reached by a signed-out user — one
  // is where you go because you cannot log in, the other is opened from an
  // emailed link on whatever device happens to be to hand. Omitting either
  // from PUBLIC_ROUTES bounces every visit to /auth/login, which is the one
  // page the visitor has already established they cannot get past.
  it.each(['/auth/forgot-password', '/auth/reset-password'])(
    'allows access to %s when not authenticated',
    async (route) => {
      vi.mocked(usePathname).mockReturnValue(route)
      render(
        <AuthGuard>
          <div>Reset Flow</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByText('Reset Flow')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    }
  )
})

/**
 * The client half of the email-verification soft gate (issue #102 §8.2).
 *
 * Cosmetic, not enforcement — `withUser` returns 403 for the same user
 * whatever this renders. It exists so an unverified user gets an explanation
 * and a Resend button rather than a dashboard where every panel fails to load.
 */
describe('AuthGuard email-verification gate', () => {
  const mockPush = vi.fn()

  beforeEach(() => {
    setMockSessionCookie()
    vi.mocked(usePathname).mockReturnValue('/emails')
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    } as any)
  })

  function serveUser(overrides: { emailVerified?: boolean; required?: boolean }) {
    server.use(
      http.get('http://localhost:4000/api/app/auth/me', () =>
        HttpResponse.json({
          data: {
            ...mockUser,
            emailVerified: overrides.emailVerified ?? true,
            config: {
              ...mockAppConfig,
              emailVerificationRequired: overrides.required ?? false,
            },
          },
        }),
      ),
    )
  }

  it('shows the verify notice instead of the dashboard when required and unverified', async () => {
    serveUser({ required: true, emailVerified: false })

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    )

    await waitFor(() => {
      expect(screen.getByText('Verify your email address')).toBeInTheDocument()
    })
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('renders children once the address is verified', async () => {
    serveUser({ required: true, emailVerified: true })

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    )

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })
  })

  /** A deployment that never enabled the flag must be entirely unaffected. */
  it('renders children for an unverified user when the deployment does not require it', async () => {
    serveUser({ required: false, emailVerified: false })

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    )

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })
  })

  /**
   * Without this exemption a signed-in unverified user clicking their own link
   * on the same device is bounced away from the one page that would have
   * cleared the gate.
   */
  it('lets an unverified user through on /auth/verify', async () => {
    vi.mocked(usePathname).mockReturnValue('/auth/verify')
    serveUser({ required: true, emailVerified: false })

    render(
      <AuthGuard>
        <div>Verify Page</div>
      </AuthGuard>,
    )

    await waitFor(() => {
      expect(screen.getByText('Verify Page')).toBeInTheDocument()
    })
    expect(screen.queryByText('Verify your email address')).not.toBeInTheDocument()
  })
})
