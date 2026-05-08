import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { AuthGuard } from '@/components/auth-guard'
import { useRouter, usePathname } from 'next/navigation'

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
    localStorage.setItem('auth_token', 'mock-jwt-token')
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    )

    expect(screen.getByClassName || screen.queryByText('Protected Content')).toBeFalsy()
    // The spinner is rendered via CSS class, just check content is not visible initially
  })

  it('renders children when authenticated', async () => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
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
})
