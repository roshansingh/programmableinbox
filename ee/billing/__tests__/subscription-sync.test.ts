import { describe, it, expect, vi, beforeEach } from 'vitest'

const planFindUniqueMock = vi.fn()
const subscriptionUpsertMock = vi.fn()
const subscriptionUpdateManyMock = vi.fn()
const subscriptionDeleteManyMock = vi.fn()
const organizationUpdateMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    plan: { findUnique: (...a: unknown[]) => planFindUniqueMock(...a) },
    subscription: {
      upsert: (...a: unknown[]) => subscriptionUpsertMock(...a),
      updateMany: (...a: unknown[]) => subscriptionUpdateManyMock(...a),
      deleteMany: (...a: unknown[]) => subscriptionDeleteManyMock(...a),
    },
    organization: { update: (...a: unknown[]) => organizationUpdateMock(...a) },
  },
}))

const PRO_PLAN = { id: 3, code: 'pro', name: 'Pro', stripePriceId: 'price_pro' }

/** A minimal Stripe subscription object, shaped like the SDK's. */
function stripeSubscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    status: 'active',
    customer: 'cus_123',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: 'price_pro' },
          current_period_start: 1_767_225_600, // 2026-01-01T00:00:00Z
          current_period_end: 1_769_904_000, // 2026-02-01T00:00:00Z
        },
      ],
    },
    metadata: { organizationId: 'org_1' },
    ...over,
  }
}

describe('mapSubscriptionStatus', () => {
  /**
   * Stripe emits eight statuses; the enum carries four. Every one of the other
   * four has to map onto a decided answer to "is this organization entitled?",
   * because a state nobody thought about must not reach the resolver.
   */
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['canceled', 'canceled'],
  ])('passes %s through unchanged', async (input, expected) => {
    const { mapSubscriptionStatus } = await import('../subscription-sync')
    expect(mapSubscriptionStatus(input)).toBe(expected)
  })

  /**
   * `unpaid` is Stripe giving up after its retry schedule, and `paused` stops
   * collection — neither is an entitled state, so both land on `canceled`
   * rather than being treated as a live subscription.
   */
  it.each([['unpaid'], ['paused']])('treats %s as canceled', async (input) => {
    const { mapSubscriptionStatus } = await import('../subscription-sync')
    expect(mapSubscriptionStatus(input)).toBe('canceled')
  })

  /**
   * `incomplete` means the first payment never succeeded — the customer never
   * became entitled at all, so it cannot map onto `active`.
   */
  it.each([['incomplete'], ['incomplete_expired']])('treats %s as canceled', async (input) => {
    const { mapSubscriptionStatus } = await import('../subscription-sync')
    expect(mapSubscriptionStatus(input)).toBe('canceled')
  })

  it('treats an unrecognised future status as canceled rather than entitled', async () => {
    const { mapSubscriptionStatus } = await import('../subscription-sync')
    // Stripe adding a status must never silently grant paid limits.
    expect(mapSubscriptionStatus('some_future_state')).toBe('canceled')
  })
})

describe('syncSubscriptionFromStripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planFindUniqueMock.mockResolvedValue(PRO_PLAN)
    subscriptionUpsertMock.mockResolvedValue({})
    subscriptionDeleteManyMock.mockResolvedValue({ count: 1 })
  })

  it('upserts the subscription against the organization', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(subscriptionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1' } }),
    )
  })

  it('records the Stripe subscription id, which is the idempotency key', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    const args = subscriptionUpsertMock.mock.calls[0][0]
    expect(args.create.externalId).toBe('sub_123')
    expect(args.update.externalId).toBe('sub_123')
  })

  it('resolves the plan from the price id rather than trusting metadata', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(planFindUniqueMock).toHaveBeenCalledWith({ where: { stripePriceId: 'price_pro' } })
  })

  it('carries the billing window, which keys the usage counters', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    const { create } = subscriptionUpsertMock.mock.calls[0][0]
    expect(create.currentPeriodStart).toEqual(new Date('2026-01-01T00:00:00Z'))
    expect(create.currentPeriodEnd).toEqual(new Date('2026-02-01T00:00:00Z'))
  })

  /**
   * A terminal status must remove the row, not store `canceled` — the resolver
   * falls back to `free` on *absence*, and a lingering row pointing at `pro`
   * would keep serving paid limits to someone who stopped paying.
   */
  it('deletes the subscription when Stripe reports a terminal status', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription({ status: 'canceled' }) as never)

    expect(subscriptionDeleteManyMock).toHaveBeenCalledWith({ where: { organizationId: 'org_1' } })
    expect(subscriptionUpsertMock).not.toHaveBeenCalled()
  })

  it('keeps the subscription on past_due, so a failed card does not stop mail', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription({ status: 'past_due' }) as never)

    expect(subscriptionDeleteManyMock).not.toHaveBeenCalled()
    expect(subscriptionUpsertMock.mock.calls[0][0].update.status).toBe('past_due')
  })

  /**
   * Stripe does not guarantee ordering, so an event for a price we do not
   * recognise (a plan deleted from the database, a price created by hand in the
   * dashboard) must not throw — throwing returns non-2xx and makes Stripe retry
   * the same unmappable event until it disables the endpoint.
   */
  it('ignores a subscription whose price maps to no plan', async () => {
    planFindUniqueMock.mockResolvedValue(null)
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await expect(
      syncSubscriptionFromStripe(stripeSubscription() as never),
    ).resolves.toEqual({ handled: false, reason: 'unknown_price' })
    expect(subscriptionUpsertMock).not.toHaveBeenCalled()
  })

  it('ignores a subscription carrying no organization', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    const result = await syncSubscriptionFromStripe(
      stripeSubscription({ metadata: {} }) as never,
    )

    expect(result).toEqual({ handled: false, reason: 'no_organization' })
    expect(subscriptionUpsertMock).not.toHaveBeenCalled()
  })

  it('stores the Stripe customer id on the organization', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(organizationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org_1' },
        data: { stripeCustomerId: 'cus_123' },
      }),
    )
  })

  /**
   * Replay is normal: Stripe redelivers, and an upsert keyed on the
   * organization makes a second identical event a no-op write rather than a
   * duplicate row or a constraint violation.
   */
  it('is idempotent across a replayed event', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)
    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(subscriptionUpsertMock).toHaveBeenCalledTimes(2)
    const [first, second] = subscriptionUpsertMock.mock.calls
    expect(first[0].create).toEqual(second[0].create)
  })
})
