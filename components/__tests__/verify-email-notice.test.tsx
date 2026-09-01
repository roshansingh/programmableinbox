import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@/test/test-utils'
import { VerifyEmailNotice } from '@/components/verify-email-notice'
import { server } from '@/test/mocks/server'
import { mockUser, mockAppConfig } from '@/test/mocks/fixtures/users'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'
import { logout } from '@/lib/api/auth.api'

const RESEND_URL = 'http://localhost:4000/api/app/auth/verification/resend'

vi.mock('@/lib/api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth.api')>()
  return { ...actual, logout: vi.fn() }
})

const originalLocation = window.location

describe('VerifyEmailNotice', () => {
  beforeEach(() => {
    setMockSessionCookie()
    vi.mocked(logout).mockClear().mockResolvedValue(undefined)
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: 'http://localhost/emails' },
    })
    server.use(
      http.get('http://localhost:4000/api/app/auth/me', () =>
        HttpResponse.json({
          data: {
            ...mockUser,
            email: 'someone@example.com',
            emailVerified: false,
            config: { ...mockAppConfig, emailVerificationRequired: true },
          },
        }),
      ),
    )
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })

  it('names the address the mail went to, because a typo at signup is why most people are here', async () => {
    render(<VerifyEmailNotice />)

    await waitFor(() => {
      expect(screen.getByText('someone@example.com')).toBeInTheDocument()
    })
  })

  it('resends and then disables the button for the cooldown', async () => {
    const { user } = render(<VerifyEmailNotice />)

    const button = await screen.findByRole('button', { name: /resend verification email/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Sent/i)
    })
    expect(screen.getByRole('button', { name: /resend in/i })).toBeDisabled()
  })

  /**
   * The client countdown is only an approximation of the server's — a page
   * reload resets ours, not theirs — so the 429 has to be handled rather than
   * assumed unreachable.
   */
  it('handles a 429 the client did not predict', async () => {
    server.use(
      http.post(RESEND_URL, () =>
        HttpResponse.json(
          { message: 'Please wait before requesting another email' },
          { status: 429 },
        ),
      ),
    )

    const { user } = render(<VerifyEmailNotice />)

    await user.click(await screen.findByRole('button', { name: /resend verification email/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/please wait a moment/i)
    })
    expect(screen.getByRole('button', { name: /resend in/i })).toBeDisabled()
  })

  it('surfaces a send failure rather than pretending it worked', async () => {
    server.use(
      http.post(RESEND_URL, () =>
        HttpResponse.json({ message: 'Could not send the verification email.' }, { status: 502 }),
      ),
    )

    const { user } = render(<VerifyEmailNotice />)

    await user.click(await screen.findByRole('button', { name: /resend verification email/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/could not send/i)
    })
  })

  /** No email-change flow exists yet, so signing out is how a wrong address is corrected. */
  it('offers a way out', async () => {
    render(<VerifyEmailNotice />)

    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  /**
   * Mirrors the equivalent assertion in user-menu.test.tsx: logout is awaited
   * before navigating, so a click here cannot start the redirect before the
   * server has cleared the httpOnly session cookie.
   */
  it('signs out by calling logout() and navigates to /auth/login only once it resolves', async () => {
    const user = userEvent.setup()
    render(<VerifyEmailNotice />)

    await user.click(await screen.findByRole('button', { name: /sign out/i }))

    expect(logout).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/auth/login')
  })

  it('still navigates to login when the server logout call fails, without an unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(logout).mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()
    render(<VerifyEmailNotice />)

    await user.click(await screen.findByRole('button', { name: /sign out/i }))

    expect(window.location.href).toBe('/auth/login')
    expect(consoleError).toHaveBeenCalledWith('Failed to log out cleanly', expect.any(Error))
    consoleError.mockRestore()
  })
})
