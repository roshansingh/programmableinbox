import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { AuthProvider } from '@/components/auth-provider'
import { mockUser, mockOrganization } from '@/test/mocks/fixtures/users'
import { useSearchParams } from 'next/navigation'
import BillingPage from '../page'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

function withCheckoutSuccess() {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('checkout=success') as never)
}

vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

const createCheckoutSessionMock = vi.fn()
const createBillingPortalSessionMock = vi.fn()
vi.mock('@/lib/api/billing.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/billing.api')>()
  return {
    ...actual,
    createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a),
    createBillingPortalSession: (...a: unknown[]) => createBillingPortalSessionMock(...a),
  }
})

const FREE_PLAN = {
  code: 'free',
  name: 'Free',
  limits: { emailInboxes: 1, incomingEmailsPerPeriod: 1000, outboundEmail: false, llmEnrichment: false },
  price: null,
}

const PRO_PLAN = {
  code: 'pro',
  name: 'Pro',
  limits: { emailInboxes: 2, incomingEmailsPerPeriod: 5000, outboundEmail: true, llmEnrichment: true },
  price: { amount: 2000, currency: 'usd', interval: 'month' },
}

function userOnPlan(planCode: 'free' | 'pro') {
  return {
    ...mockUser,
    organizations: [
      {
        ...mockOrganization,
        plan: planCode === 'free' ? FREE_PLAN : PRO_PLAN,
      },
    ],
  }
}

function mockAuthMe(user: unknown) {
  server.use(
    http.get('http://localhost:4000/api/app/auth/me', () => HttpResponse.json({ data: user })),
  )
}

function mockPlansEndpoint(plans: unknown[] = [FREE_PLAN, PRO_PLAN]) {
  server.use(
    http.get('http://localhost:4000/api/app/billing/plans', () =>
      HttpResponse.json({ data: { plans } }),
    ),
  )
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<AuthProvider>{ui}</AuthProvider>)
}

/**
 * `CardTitle` renders a plain `div` (this repo's shadcn pattern throughout),
 * so plan names carry no ARIA heading role — found by the card-title slot
 * instead of `getByRole('heading', ...)`.
 */
function findCardTitle(name: string) {
  return screen.findByText(name, { selector: '[data-slot="card-title"]' })
}

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never)
    setMockSessionCookie()
  })

  it('reports billing as unavailable when the deployment has no plan', async () => {
    mockAuthMe(mockUser)
    renderWithProviders(<BillingPage />)

    expect(await screen.findByText(/billing is not available/i)).toBeInTheDocument()
  })

  it('renders both plans once loaded', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    expect(await findCardTitle('Free')).toBeInTheDocument()
    expect(await findCardTitle('Pro')).toBeInTheDocument()
  })

  it('shows the 5 plan details: inboxes, incoming emails, outbound email, AI enrichment and price', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    const proCard = (await findCardTitle('Pro')).closest('[data-slot="card"]') as HTMLElement

    expect(proCard).toHaveTextContent(/2.*email inboxes/i)
    expect(proCard).toHaveTextContent(/5,000.*incoming emails/i)
    expect(proCard).toHaveTextContent(/outbound email/i)
    expect(proCard).toHaveTextContent(/AI enrichment/i)
    expect(proCard).toHaveTextContent('$20.00/month')
  })

  it('singularizes a count of exactly 1, rather than "1 email inboxes"', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    const freeCard = (await findCardTitle('Free')).closest('[data-slot="card"]') as HTMLElement

    expect(freeCard).toHaveTextContent('1 email inbox')
    expect(freeCard).not.toHaveTextContent('1 email inboxes')
  })

  it('marks the organization\'s current plan', async () => {
    mockAuthMe(userOnPlan('pro'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    const proCard = (await findCardTitle('Pro')).closest('[data-slot="card"]') as HTMLElement
    expect(proCard).toHaveTextContent(/current plan/i)
  })

  it('offers an upgrade to Pro when the organization is on Free', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    createCheckoutSessionMock.mockResolvedValue({ url: 'https://checkout.stripe.com/c/cs_1' })
    renderWithProviders(<BillingPage />)

    const upgrade = await screen.findByRole('button', { name: /upgrade to pro/i })
    upgrade.click()

    await waitFor(() => expect(createCheckoutSessionMock).toHaveBeenCalledWith('org-1', 'pro'))
  })

  /**
   * There is no downgrade route — cancelling happens through Stripe's Billing
   * Portal, reached from the Pro card, which is what makes the org fall back
   * to Free on its own once the subscription ends.
   */
  it('offers billing management, not a downgrade button, on the current Pro plan', async () => {
    mockAuthMe(userOnPlan('pro'))
    mockPlansEndpoint()
    createBillingPortalSessionMock.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' })
    renderWithProviders(<BillingPage />)

    const manage = await screen.findByRole('button', { name: /manage billing/i })
    manage.click()

    await waitFor(() => expect(createBillingPortalSessionMock).toHaveBeenCalledWith('org-1'))
  })

  it('offers no action on the Free card when the organization is already on Pro', async () => {
    mockAuthMe(userOnPlan('pro'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    const freeCard = (await findCardTitle('Free')).closest('[data-slot="card"]') as HTMLElement
    expect(freeCard.querySelector('button')).toBeNull()
  })

  it('disables the current Free plan\'s button rather than offering to switch to it', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    renderWithProviders(<BillingPage />)

    const freeCard = (await findCardTitle('Free')).closest('[data-slot="card"]') as HTMLElement
    const button = freeCard.querySelector('button') as HTMLButtonElement
    expect(button).toBeDisabled()
  })

  it('reports a plan with no configured price as not available yet rather than starting checkout', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint([FREE_PLAN, { ...PRO_PLAN, price: null }])
    renderWithProviders(<BillingPage />)

    const button = await screen.findByRole('button', { name: /not available yet/i })
    expect(button).toBeDisabled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('reports a checkout failure rather than failing silently', async () => {
    mockAuthMe(userOnPlan('free'))
    mockPlansEndpoint()
    createCheckoutSessionMock.mockRejectedValue({ message: 'Could not start checkout' })
    renderWithProviders(<BillingPage />)

    ;(await screen.findByRole('button', { name: /upgrade to pro/i })).click()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start checkout/i)
  })

  /**
   * Stripe redirects to success_url as soon as payment settles, but the
   * webhook that actually writes the Subscription row is a separate,
   * asynchronous call from Stripe's backend that can still be in flight when
   * this page mounts — a single /auth/me refetch on mount can race it.
   */
  describe('returning from a successful checkout', () => {
    afterEach(() => {
      vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never)
    })

    it('scrubs the checkout param from the URL', async () => {
      withCheckoutSuccess()
      mockAuthMe(userOnPlan('free'))
      mockPlansEndpoint()
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

      renderWithProviders(<BillingPage />)

      await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled())
    })

    it('shows a confirming message while re-checking the session', async () => {
      withCheckoutSuccess()
      mockAuthMe(userOnPlan('free'))
      mockPlansEndpoint()

      renderWithProviders(<BillingPage />)

      expect(await screen.findByText(/confirming your subscription/i)).toBeInTheDocument()
    })

    it('retries the session fetch and picks up the plan once the webhook lands', async () => {
      withCheckoutSuccess()
      mockPlansEndpoint()
      let calls = 0
      server.use(
        http.get('http://localhost:4000/api/app/auth/me', () => {
          calls++
          // First call still reflects the pre-webhook state — the race this
          // retry exists to cover.
          return HttpResponse.json({ data: calls === 1 ? userOnPlan('free') : userOnPlan('pro') })
        }),
      )

      renderWithProviders(<BillingPage />)

      const proCard = (await findCardTitle('Pro')).closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(proCard).toHaveTextContent(/current plan/i), { timeout: 3000 })
      expect(calls).toBeGreaterThanOrEqual(2)
    })

    /**
     * `refreshUser` (components/auth-provider.tsx) wraps its fetch in
     * try/catch and never re-throws, so a transient failure on the first
     * /auth/me call must not abort the retry chain — the delayed second
     * refreshUser() call has to run regardless.
     */
    it('still performs the delayed retry when the first session fetch fails', async () => {
      withCheckoutSuccess()
      mockPlansEndpoint()
      let calls = 0
      server.use(
        http.get('http://localhost:4000/api/app/auth/me', () => {
          calls++
          if (calls === 1) return HttpResponse.json({ message: 'network hiccup' }, { status: 500 })
          return HttpResponse.json({ data: userOnPlan('pro') })
        }),
      )

      renderWithProviders(<BillingPage />)

      const proCard = (await findCardTitle('Pro')).closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(proCard).toHaveTextContent(/current plan/i), { timeout: 3000 })
      expect(calls).toBeGreaterThanOrEqual(2)
    })
  })
})
