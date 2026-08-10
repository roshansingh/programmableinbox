import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UNLIMITED } from '@/lib/commercial/plan-limits'

const mockSubscriptionFindUnique = vi.fn()
const mockPlanFindUnique = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: { findUnique: mockSubscriptionFindUnique },
    plan: { findUnique: mockPlanFindUnique },
  },
}))

const FREE_PLAN = {
  id: 2,
  code: 'free',
  name: 'Free',
  limits: {
    emailInboxes: 1,
    incomingEmailsPerPeriod: 1000,
    outboundEmail: false,
    llmEnrichment: false,
    overQuotaBehavior: 'drop',
  },
}

const PRO_PLAN = {
  id: 3,
  code: 'pro',
  name: 'Pro',
  limits: { emailInboxes: 2, incomingEmailsPerPeriod: 5000, overQuotaBehavior: 'drop' },
}

describe('DbPlanResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscriptionFindUnique.mockResolvedValue(null)
    mockPlanFindUnique.mockResolvedValue(FREE_PLAN)
  })

  async function resolver() {
    const { DbPlanResolver } = await import('../resolver')
    return new DbPlanResolver()
  }

  /**
   * The property that lets USE_COMMERCIAL be switched on in production without
   * a backfill: every pre-existing organization has no Subscription row, and
   * must land on `free` rather than throwing or resolving to unlimited.
   */
  it('resolves an organization with no subscription to the free plan', async () => {
    const plan = await (await resolver()).resolve('org-1')

    expect(mockPlanFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'free' } }))
    expect(plan.planCode).toBe('free')
    expect(plan.limits.emailInboxes).toBe(1)
  })

  it('resolves an organization with a subscription to that plan', async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
      plan: PRO_PLAN,
    })

    const plan = await (await resolver()).resolve('org-1')

    expect(plan.planCode).toBe('pro')
    expect(plan.limits.emailInboxes).toBe(2)
    // The free-plan fallback must not have been consulted.
    expect(mockPlanFindUnique).not.toHaveBeenCalled()
  })

  /**
   * Sparse storage is the seeding convention: a plan row lists only what it
   * restricts. If the resolver returned the raw JSON, every unlisted limit
   * would be `undefined` and every enforcement site would have to defend
   * against it.
   */
  it('fills unlisted limits from the schema defaults', async () => {
    const plan = await (await resolver()).resolve('org-1')

    expect(plan.limits.apiKeys).toBeNull()
    expect(plan.limits.webhooks).toBeNull()
    expect(plan.limits.mcpAccess).toBe(true)
  })

  it('never exposes the numeric plan id', async () => {
    const plan = await (await resolver()).resolve('org-1')

    expect(plan).not.toHaveProperty('planId')
    expect(plan).not.toHaveProperty('id')
    expect(plan.planCode).toBe('free')
    expect(plan.planName).toBe('Free')
  })

  it('carries the subscription period so counters key on the billing window', async () => {
    const start = new Date('2026-07-15T00:00:00Z')
    const end = new Date('2100-08-15T00:00:00Z')
    mockSubscriptionFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      status: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      plan: PRO_PLAN,
    })

    const plan = await (await resolver()).resolve('org-1')

    expect(plan.periodStart).toEqual(start)
    expect(plan.periodEnd).toEqual(end)
  })

  it('falls back to a calendar-month period when there is no subscription', async () => {
    const plan = await (await resolver()).resolve('org-1')

    expect(plan.periodStart).toBeInstanceOf(Date)
    expect(plan.periodEnd).toBeInstanceOf(Date)
    expect(plan.periodStart!.getUTCDate()).toBe(1)
    expect(plan.periodStart!.getUTCHours()).toBe(0)
  })

  /**
   * Malformed limits must be loud. Silently degrading to defaults would mean a
   * fat-fingered plan row quietly stops enforcing the cap it exists to apply.
   */
  it('throws when a plan row carries malformed limits', async () => {
    mockPlanFindUnique.mockResolvedValue({ ...FREE_PLAN, limits: { emailInboxes: 'lots' } })

    await expect((await resolver()).resolve('org-1')).rejects.toThrow()
  })

  /**
   * A deployment with USE_COMMERCIAL on but no seeded plans is misconfigured.
   * Falling back to unlimited would hand every organization an unmetered
   * account and look like success.
   */
  it('throws when the free plan is missing entirely', async () => {
    mockPlanFindUnique.mockResolvedValue(null)

    await expect((await resolver()).resolve('org-1')).rejects.toThrow(/free/i)
  })

  /**
   * Entitlement follows `Subscription.status`, which the resolver previously
   * ignored entirely — any row at all meant paid limits.
   */
  describe('subscription status', () => {
    function subscribed(status: string) {
      return {
        organizationId: 'org-1',
        status,
        currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEnd: new Date('2100-09-01T00:00:00Z'),
        plan: PRO_PLAN,
      }
    }

    it.each([['active'], ['trialing']])('serves the paid plan while %s', async (status) => {
      mockSubscriptionFindUnique.mockResolvedValue(subscribed(status))

      expect((await (await resolver()).resolve('org-1')).planCode).toBe('pro')
    })

    /**
     * The one that matters. Stripe retries a failed card for roughly three
     * weeks; dropping to `free` on the first decline would stop a paying
     * customer's mail over an expired card — and on a `drop` plan that mail is
     * discarded irrecoverably. Entitlement ends when Stripe gives up, not when
     * a charge bounces.
     */
    it('keeps serving the paid plan while past_due', async () => {
      mockSubscriptionFindUnique.mockResolvedValue(subscribed('past_due'))

      const plan = await (await resolver()).resolve('org-1')

      expect(plan.planCode).toBe('pro')
      expect(plan.limits.emailInboxes).toBe(2)
    })

    /**
     * A `canceled` row should not exist — the webhook deletes on a terminal
     * status — but if one is ever left behind it must not keep serving paid
     * limits to someone who stopped paying.
     */
    it('falls back to free on a canceled row rather than trusting it', async () => {
      mockSubscriptionFindUnique.mockResolvedValue(subscribed('canceled'))

      const plan = await (await resolver()).resolve('org-1')

      expect(plan.planCode).toBe('free')
      expect(mockPlanFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: 'free' } }),
      )
    })

    it('ignores the stale billing window of an unentitled subscription', async () => {
      // Mid-month, so a calendar-month fallback is distinguishable from the
      // subscription's own window rather than coinciding with it.
      mockSubscriptionFindUnique.mockResolvedValue({
        ...subscribed('canceled'),
        currentPeriodStart: new Date('2026-08-17T00:00:00Z'),
        currentPeriodEnd: new Date('2100-09-17T00:00:00Z'),
      })

      const plan = await (await resolver()).resolve('org-1')

      // The counters must key on the calendar month, not on a dead
      // subscription's anniversary.
      expect(plan.periodStart!.getUTCDate()).toBe(1)
    })
  })

  it('treats an unlimited plan row as unrestricted', async () => {
    mockPlanFindUnique.mockResolvedValue({ id: 1, code: 'self_hosted', name: 'Self-hosted', limits: {} })

    const plan = await (await resolver()).resolve('org-1')

    expect(plan.limits).toEqual(UNLIMITED)
  })
})
