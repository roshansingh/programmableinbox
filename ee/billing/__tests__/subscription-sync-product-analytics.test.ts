/**
 * checkout_completed (issue #152): the actual conversion event, fired the
 * moment `syncSubscriptionFromStripe` creates a *new* Subscription row —
 * i.e. one that did not exist for this organization before this call. A
 * renewal or plan change on an existing subscription is not a second
 * conversion.
 *
 * distinct_id resolution here is the one call site with no principal at all
 * (this runs from a Stripe webhook, not an authenticated request), so it
 * falls back to the organization's owner-role member, keeping the event on
 * the same identity timeline every other capture call uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv } from '@/test/config'

const planFindUniqueMock = vi.fn()
const subscriptionUpsertMock = vi.fn()
const subscriptionFindUniqueMock = vi.fn()
const organizationUpdateMock = vi.fn()
const organizationFindUniqueMock = vi.fn()
const membershipFindFirstMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    plan: { findUnique: (...a: unknown[]) => planFindUniqueMock(...a) },
    subscription: {
      upsert: (...a: unknown[]) => subscriptionUpsertMock(...a),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: (...a: unknown[]) => subscriptionFindUniqueMock(...a),
    },
    organization: {
      update: (...a: unknown[]) => organizationUpdateMock(...a),
      findUnique: (...a: unknown[]) => organizationFindUniqueMock(...a),
    },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirstMock(...a),
    },
  },
}))

vi.mock('@/ee/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { checkoutCompleted: 'checkout_completed' },
}))

const PRO_PLAN = { id: 3, code: 'pro', name: 'Pro', stripePriceId: 'price_pro' }

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
          current_period_start: 1_767_225_600,
          current_period_end: 1_769_904_000,
        },
      ],
    },
    metadata: { organizationId: 'org_1' },
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  planFindUniqueMock.mockResolvedValue(PRO_PLAN)
  subscriptionUpsertMock.mockResolvedValue({})
  organizationFindUniqueMock.mockResolvedValue({ id: 'org_1' })
  subscriptionFindUniqueMock.mockResolvedValue(null)
  membershipFindFirstMock.mockResolvedValue({ userId: 'owner_1' })
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('does not capture anything, and does not even look up the owner', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')

    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(captureEventMock).not.toHaveBeenCalled()
    expect(membershipFindFirstMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures checkout_completed for a genuinely new subscription, keyed on the org owner', async () => {
    subscriptionFindUniqueMock.mockResolvedValue(null)

    const { syncSubscriptionFromStripe } = await import('../subscription-sync')
    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(captureEventMock).toHaveBeenCalledWith(
      'checkout_completed',
      'owner_1',
      expect.objectContaining({ organizationId: 'org_1', planCode: 'pro' }),
    )
  })

  it('does not re-fire on a renewal/plan-change sync for an existing subscription', async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ id: 'existing_sub_row' })

    const { syncSubscriptionFromStripe } = await import('../subscription-sync')
    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('falls back to the organization id when no owner membership is found', async () => {
    membershipFindFirstMock.mockResolvedValue(null)

    const { syncSubscriptionFromStripe } = await import('../subscription-sync')
    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(captureEventMock).toHaveBeenCalledWith('checkout_completed', 'org_1', expect.anything())
  })

  it('does not capture on a terminal (cancellation) sync', async () => {
    const { syncSubscriptionFromStripe } = await import('../subscription-sync')
    await syncSubscriptionFromStripe(stripeSubscription({ status: 'canceled' }) as never)

    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('does not capture when the organization does not exist', async () => {
    organizationFindUniqueMock.mockResolvedValue(null)

    const { syncSubscriptionFromStripe } = await import('../subscription-sync')
    await syncSubscriptionFromStripe(stripeSubscription() as never)

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
