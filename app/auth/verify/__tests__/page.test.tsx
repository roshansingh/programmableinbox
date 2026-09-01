import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@/test/test-utils'
import VerifyEmailPage from '@/app/auth/verify/page'
import { server } from '@/test/mocks/server'
import { mockUser, mockAppConfig } from '@/test/mocks/fixtures/users'
import { useSearchParams } from 'next/navigation'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

const CONFIRM_URL = 'http://localhost:4000/api/app/auth/verification/confirm'
const ME_URL = 'http://localhost:4000/api/app/auth/me'

function withToken(token: string | null) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(token === null ? '' : `token=${token}`) as never,
  )
}

/** A signed-in visitor: /auth/me resolves, so the page can unlock in place. */
function withSession() {
  setMockSessionCookie()
  server.use(
    http.get(ME_URL, () =>
      HttpResponse.json({
        data: {
          ...mockUser,
          emailVerified: true,
          config: { ...mockAppConfig, emailVerificationRequired: true },
        },
      }),
    ),
  )
}

/** The phone case: the link opened on a device that holds no session. */
function withoutSession() {
  server.use(http.get(ME_URL, () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))
}

describe('/auth/verify', () => {
  beforeEach(() => {
    withToken('a-verification-token')
    window.history.replaceState(null, '', '/auth/verify?token=a-verification-token')
  })

  it('redeems the token and confirms success when a session exists', async () => {
    withSession()

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('Email verified')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /go to the dashboard/i })).toBeInTheDocument()
  })

  /**
   * The regression this guards: `isAuthenticated` inside the mount effect is
   * the mount-time value — /auth/me has not resolved yet, so it is false even
   * for a signed-in user. Branching the refresh on it skipped it every time,
   * leaving a `user` still carrying `emailVerified: false`, which sends the
   * newly-verified user straight back into the gate on the next page.
   */
  it('refetches the user after redeeming, so the gate does not re-engage on stale state', async () => {
    setMockSessionCookie()

    let meCalls = 0
    server.use(
      http.get(ME_URL, () => {
        meCalls += 1
        return HttpResponse.json({
          data: {
            ...mockUser,
            // Unverified on the provider's first fetch, verified afterwards —
            // exactly the transition the redemption causes.
            emailVerified: meCalls > 1,
            config: { ...mockAppConfig, emailVerificationRequired: true },
          },
        })
      }),
    )

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('Email verified')).toBeInTheDocument()
    })
    expect(meCalls).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: /go to the dashboard/i })).toBeInTheDocument()
  })

  it('points at sign-in when the link was opened without a session', async () => {
    withoutSession()

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('Email verified')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /go to sign in/i })).toBeInTheDocument()
  })

  /**
   * Left in the URL the token persists in browser history and leaks through
   * the `Referer` header of any third-party resource the page loads.
   */
  it('scrubs the token from the URL', async () => {
    withSession()

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(window.location.search).toBe('')
    })
  })

  it('distinguishes an expired link so the user knows a new one will work', async () => {
    withoutSession()
    server.use(
      http.post(CONFIRM_URL, () =>
        HttpResponse.json({ message: 'This verification link has expired' }, { status: 400 }),
      ),
    )

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('This link has expired')).toBeInTheDocument()
    })
  })

  it('reports an invalid link', async () => {
    withoutSession()
    server.use(
      http.post(CONFIRM_URL, () =>
        HttpResponse.json({ message: 'This verification link is invalid' }, { status: 400 }),
      ),
    )

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('This link is not valid')).toBeInTheDocument()
    })
  })

  it('reports a missing token without calling the server', async () => {
    withoutSession()
    withToken(null)

    let called = false
    server.use(
      http.post(CONFIRM_URL, () => {
        called = true
        return HttpResponse.json({ data: { verified: true } })
      }),
    )

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(screen.getByText('This link is not valid')).toBeInTheDocument()
    })
    expect(called).toBe(false)
  })
})
