import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@/test/test-utils'
import { VerifyEmailNotice } from '@/components/verify-email-notice'
import { server } from '@/test/mocks/server'
import { mockUser, mockAppConfig } from '@/test/mocks/fixtures/users'

const RESEND_URL = 'http://localhost:4000/api/app/auth/verification/resend'

describe('VerifyEmailNotice', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
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
})
