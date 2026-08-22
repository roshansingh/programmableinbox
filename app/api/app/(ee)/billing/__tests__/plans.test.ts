import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const planFindManyMock = vi.fn()
const priceRetrieveMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...a: unknown[]) => resolveUserPrincipalFromTokenMock(...a),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    plan: { findMany: (...a: unknown[]) => planFindManyMock(...a) },
  },
}))

vi.mock('@/ee/billing/client', () => ({
  getStripe: () => ({ prices: { retrieve: (...a: unknown[]) => priceRetrieveMock(...a) } }),
}))

const FREE_PLAN = {
  id: 2,
  code: 'free',
  name: 'Free',
  stripePriceId: null,
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
  stripePriceId: 'price_pro',
  limits: {
    emailInboxes: 2,
    incomingEmailsPerPeriod: 5000,
    overQuotaBehavior: 'drop',
  },
}

function request() {
  return new NextRequest('http://localhost:3000/api/app/billing/plans', {
    method: 'GET',
    headers: { authorization: 'Bearer token' },
  })
}

const ctx = { params: Promise.resolve({}) }

function principal() {
  return {
    kind: 'user',
    userId: 'user_1',
    emailVerified: true,
    memberships: [{ organizationId: 'org_1', role: 'member' }],
  }
}

describe('GET /api/app/billing/plans', () => {
  withConfigEnv({
    USE_COMMERCIAL: 'true',
    STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwx',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrstuvwx',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principal())
    planFindManyMock.mockResolvedValue([FREE_PLAN, PRO_PLAN])
    priceRetrieveMock.mockResolvedValue({
      unit_amount: 2000,
      currency: 'usd',
      recurring: { interval: 'month' },
    })
  })

  it('returns the public plans with their limits', async () => {
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.plans).toEqual([
      expect.objectContaining({
        code: 'free',
        name: 'Free',
        limits: {
          emailInboxes: 1,
          incomingEmailsPerPeriod: 1000,
          outboundEmail: false,
          llmEnrichment: false,
        },
      }),
      expect.objectContaining({
        code: 'pro',
        name: 'Pro',
        limits: {
          emailInboxes: 2,
          incomingEmailsPerPeriod: 5000,
          // Not set on the seeded row; PlanLimitsSchema fills the permissive default.
          outboundEmail: true,
          llmEnrichment: true,
        },
      }),
    ])
  })

  it('queries only public plans, oldest first', async () => {
    const { GET } = await import('../plans/route')

    await GET(request(), ctx)

    expect(planFindManyMock).toHaveBeenCalledWith({
      where: { isPublic: true },
      orderBy: { id: 'asc' },
    })
  })

  it('fetches the price for a plan with a configured Stripe price', async () => {
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(priceRetrieveMock).toHaveBeenCalledWith('price_pro')
    expect(body.data.plans.find((p: { code: string }) => p.code === 'pro').price).toEqual({
      amount: 2000,
      currency: 'usd',
      interval: 'month',
    })
  })

  it('returns a null price for a plan with no Stripe price configured, without calling Stripe', async () => {
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(body.data.plans.find((p: { code: string }) => p.code === 'free').price).toBeNull()
    expect(priceRetrieveMock).not.toHaveBeenCalledWith(null)
  })

  it('degrades to a null price rather than failing the whole list when Stripe errors', async () => {
    priceRetrieveMock.mockRejectedValue(new Error('Stripe is down'))
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.plans.find((p: { code: string }) => p.code === 'pro').price).toBeNull()
  })

  /**
   * A tiered/graduated Stripe price has no single `unit_amount`. Defaulting it
   * to 0 would show "$0.00/month" for a plan that is not free — worse than
   * showing nothing, since it looks like a real, checked price.
   */
  it('reports a price with no unit_amount as unavailable rather than $0', async () => {
    priceRetrieveMock.mockResolvedValue({ unit_amount: null, currency: 'usd', recurring: { interval: 'month' } })
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(body.data.plans.find((p: { code: string }) => p.code === 'pro').price).toBeNull()
  })

  /**
   * A price with no `recurring` info isn't billed monthly (or on any interval
   * we know); defaulting to "month" would misstate real billing terms.
   */
  it('reports a price with no recurring interval as unavailable rather than defaulting to monthly', async () => {
    priceRetrieveMock.mockResolvedValue({ unit_amount: 2000, currency: 'usd', recurring: null })
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(body.data.plans.find((p: { code: string }) => p.code === 'pro').price).toBeNull()
  })
})

describe('GET /api/app/billing/plans with the commercial layer off', () => {
  withConfigEnv({ USE_COMMERCIAL: 'false' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principal())
  })

  it('404s without touching the database', async () => {
    const { GET } = await import('../plans/route')

    const response = await GET(request(), ctx)

    expect(response.status).toBe(404)
    expect(planFindManyMock).not.toHaveBeenCalled()
  })
})
