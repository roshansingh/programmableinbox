import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { UsageBanner } from '../usage-banner'
import type { MetricUsage } from '@/lib/api/usage.api'

const getUsageMock = vi.fn()
const useAuthMock = vi.fn()

vi.mock('@/lib/api/usage.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/usage.api')>()
  return { ...actual, getUsage: (...a: unknown[]) => getUsageMock(...a) }
})

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => useAuthMock(),
}))

const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/api/billing.api', () => ({
  createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a),
}))

const FREE_PLAN = {
  code: 'free',
  name: 'Free',
  limits: { overQuotaBehavior: 'drop' } as never,
}

function metric(over: Partial<MetricUsage> & { metric: string }): MetricUsage {
  return { limit: null, used: 0, resetsAt: null, ...over }
}

function authState(plan: unknown) {
  return { plan, organizationId: 'org_1', isAuthenticated: true }
}

describe('UsageBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue(authState(FREE_PLAN))
    getUsageMock.mockResolvedValue({ organizationId: 'org_1', plan: FREE_PLAN, usage: [] })
  })

  /**
   * The self-hosted case. No plan means USE_COMMERCIAL is off, so there is
   * nothing to meter — and crucially the component must not even make the
   * request.
   */
  it('renders nothing and fetches nothing when there is no plan', async () => {
    useAuthMock.mockReturnValue(authState(null))

    const { container } = render(<UsageBanner />)

    expect(container).toBeEmptyDOMElement()
    expect(getUsageMock).not.toHaveBeenCalled()
  })

  it('renders nothing while every metric is well under its limit', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: 1000, used: 10 })],
    })

    const { container } = render(<UsageBanner />)

    await waitFor(() => expect(getUsageMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('warns at 80% before the limit is reached', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: 1000, used: 800 })],
    })

    render(<UsageBanner />)

    expect(await screen.findByText(/Approaching your Free plan limit/i)).toBeInTheDocument()
    expect(screen.getByText(/800 of 1000 incoming emails/i)).toBeInTheDocument()
  })

  /**
   * The warning has to state the consequence, not just the number. On a `drop`
   * plan reaching the cap destroys mail irreversibly, so a user who only learns
   * at 100% has already lost messages.
   */
  it('says mail will be discarded when the plan drops over quota', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: 1000, used: 850 })],
    })

    render(<UsageBanner />)

    expect(await screen.findByText(/discarded once the limit is reached/i)).toBeInTheDocument()
  })

  it('reports that incoming mail is no longer processed at the limit', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: 1000, used: 1000 })],
    })

    render(<UsageBanner />)

    expect(
      await screen.findByText(/incoming email is not being processed/i),
    ).toBeInTheDocument()
  })

  /**
   * The count of lost mail is what actually motivates an upgrade — "you are at
   * your limit" says nothing about how much never arrived.
   */
  it('reports how many messages were discarded', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [
        metric({ metric: 'emails.processed', limit: 1000, used: 1000 }),
        metric({ metric: 'emails.dropped', used: 247 }),
      ],
    })

    render(<UsageBanner />)

    expect(
      await screen.findByText(/247 messages have been discarded and cannot be recovered/i),
    ).toBeInTheDocument()
  })

  it('does not claim mail was discarded on an overage plan', async () => {
    const proPlan = { code: 'pro', name: 'Pro', limits: { overQuotaBehavior: 'overage' } as never }
    useAuthMock.mockReturnValue(authState(proPlan))
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: proPlan,
      usage: [metric({ metric: 'emails.processed', limit: 5000, used: 5000 })],
    })

    render(<UsageBanner />)

    expect(await screen.findByText(/reached your Pro plan limit/i)).toBeInTheDocument()
    expect(screen.queryByText(/not being processed/i)).not.toBeInTheDocument()
  })

  /**
   * A zero limit is fully consumed, not a division by zero — "none allowed" is
   * at its cap by definition.
   */
  it('treats a zero limit as reached', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.sent', limit: 0, used: 0 })],
    })

    render(<UsageBanner />)

    expect(await screen.findByText(/reached your Free plan limit/i)).toBeInTheDocument()
  })

  it('ignores unlimited metrics entirely', async () => {
    getUsageMock.mockResolvedValue({
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: null, used: 999_999 })],
    })

    const { container } = render(<UsageBanner />)

    await waitFor(() => expect(getUsageMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * The banner exists to warn *before* irreversible loss, so a single fetch on
   * mount defeats it: a dashboard left open crosses 80% and then the cap
   * without ever updating, and on a `drop` plan the mail in between is gone.
   */
  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('refetches on an interval so a long-lived dashboard stays current', async () => {
      getUsageMock.mockResolvedValue({ organizationId: 'org_1', plan: FREE_PLAN, usage: [] })
      render(<UsageBanner />)

      await vi.waitFor(() => expect(getUsageMock).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(60_000)

      expect(getUsageMock).toHaveBeenCalledTimes(2)
    })

    it('stops polling once unmounted', async () => {
      getUsageMock.mockResolvedValue({ organizationId: 'org_1', plan: FREE_PLAN, usage: [] })
      const { unmount } = render(<UsageBanner />)

      await vi.waitFor(() => expect(getUsageMock).toHaveBeenCalledTimes(1))
      unmount()
      await vi.advanceTimersByTimeAsync(180_000)

      expect(getUsageMock).toHaveBeenCalledTimes(1)
    })

    it('does not poll when there is no plan', async () => {
      useAuthMock.mockReturnValue(authState(null))
      render(<UsageBanner />)

      await vi.advanceTimersByTimeAsync(180_000)

      expect(getUsageMock).not.toHaveBeenCalled()
    })
  })

  describe('upgrade', () => {
    const exhausted = {
      organizationId: 'org_1',
      plan: FREE_PLAN,
      usage: [metric({ metric: 'emails.processed', limit: 1000, used: 1000 })],
    }

    it('offers an upgrade once the limit is reached', async () => {
      getUsageMock.mockResolvedValue(exhausted)
      render(<UsageBanner />)

      expect(await screen.findByRole('button', { name: /upgrade/i })).toBeInTheDocument()
    })

    it('names the plan by code, so the server resolves the price', async () => {
      getUsageMock.mockResolvedValue(exhausted)
      createCheckoutSessionMock.mockResolvedValue({ url: 'https://checkout.stripe.com/c/cs_1' })
      render(<UsageBanner />)

      ;(await screen.findByRole('button', { name: /upgrade/i })).click()

      await waitFor(() =>
        expect(createCheckoutSessionMock).toHaveBeenCalledWith('org_1', 'pro'),
      )
    })

    /**
     * Someone already on `pro` who is over a meter needs the billing portal or
     * support, not a second subscription to the plan they already hold.
     */
    it('offers nothing to an organization already on the paid plan', async () => {
      const proPlan = { code: 'pro', name: 'Pro', limits: { overQuotaBehavior: 'overage' } as never }
      useAuthMock.mockReturnValue(authState(proPlan))
      getUsageMock.mockResolvedValue({
        organizationId: 'org_1',
        plan: proPlan,
        usage: [metric({ metric: 'emails.processed', limit: 5000, used: 5000 })],
      })
      render(<UsageBanner />)

      await screen.findByText(/reached your Pro plan limit/i)
      expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
    })

    /**
     * A silent failure on a paid action is the worst outcome — the user cannot
     * tell whether they were charged.
     */
    it('reports a checkout failure rather than failing silently', async () => {
      getUsageMock.mockResolvedValue(exhausted)
      createCheckoutSessionMock.mockRejectedValue({ message: 'Could not start checkout' })
      render(<UsageBanner />)

      ;(await screen.findByRole('button', { name: /upgrade/i })).click()

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not start checkout/i)
    })
  })

  /**
   * Usage is advisory — the server enforces the limits regardless. A failed
   * poll must never take the dashboard down with it.
   */
  it('stays silent when the usage request fails', async () => {
    getUsageMock.mockRejectedValue(new Error('network'))

    const { container } = render(<UsageBanner />)

    await waitFor(() => expect(getUsageMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
