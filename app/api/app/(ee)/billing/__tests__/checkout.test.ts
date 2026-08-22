import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const planFindUniqueMock = vi.fn()
const organizationFindUniqueMock = vi.fn()
const createSessionMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...a: unknown[]) => resolveUserPrincipalFromTokenMock(...a),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    plan: { findUnique: (...a: unknown[]) => planFindUniqueMock(...a) },
    organization: { findUnique: (...a: unknown[]) => organizationFindUniqueMock(...a) },
  },
}))

vi.mock('@/ee/billing/client', () => ({
  getStripe: () => ({ checkout: { sessions: { create: (...a: unknown[]) => createSessionMock(...a) } } }),
}))

const PRO_PLAN = { id: 3, code: 'pro', name: 'Pro', stripePriceId: 'price_pro', isPublic: true }

function request(body: unknown = { organizationId: 'org_1', planCode: 'pro' }) {
  return new NextRequest('http://localhost:3000/api/app/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({}) }

function principalWithRole(role: string) {
  return {
    kind: 'user',
    userId: 'user_1',
    emailVerified: true,
    memberships: [{ organizationId: 'org_1', role }],
  }
}

describe('POST /api/app/billing/checkout', () => {
  withConfigEnv({
    USE_COMMERCIAL: 'true',
    STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwx',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrstuvwx',
    ENABLE_EMAIL_VERIFICATION: 'true',
    EMAIL_LINK_SECRET: 'email-link-secret-at-least-16',
    APP_BASE_URL: 'https://app.example.com',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principalWithRole('owner'))
    planFindUniqueMock.mockResolvedValue(PRO_PLAN)
    organizationFindUniqueMock.mockResolvedValue({ id: 'org_1', stripeCustomerId: null })
    createSessionMock.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' })
  })

  it('returns the session URL for an owner', async () => {
    const { POST } = await import('../checkout/route')

    const response = await POST(request(), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.url).toBe('https://checkout.stripe.com/c/cs_1')
  })

  /**
   * The price is what the customer is actually billed. Taking it from the
   * request would let anyone subscribe the organization to a $0 price they
   * created in their own Stripe account.
   */
  it('takes the price from the database, never from the request', async () => {
    const { POST } = await import('../checkout/route')

    await POST(request({ organizationId: 'org_1', planCode: 'pro', priceId: 'price_attacker' }), ctx)

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: 'price_pro', quantity: 1 }] }),
    )
  })

  it.each([['member'], ['viewer']])('refuses a %s, who would be spending someone else\'s money', async (role) => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principalWithRole(role))
    const { POST } = await import('../checkout/route')

    const response = await POST(request(), ctx)

    expect(response.status).toBe(403)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('allows an admin', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principalWithRole('admin'))
    const { POST } = await import('../checkout/route')

    expect((await POST(request(), ctx)).status).toBe(200)
  })

  /**
   * The membership check belongs to `toOrgScope`; this route must not become a
   * second, weaker tenancy predicate.
   */
  it('403s for an organization the caller does not belong to', async () => {
    const { POST } = await import('../checkout/route')

    const response = await POST(request({ organizationId: 'org_other', planCode: 'pro' }), ctx)

    expect(response.status).toBe(403)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('carries the organization in both the reference and the subscription metadata', async () => {
    const { POST } = await import('../checkout/route')

    await POST(request(), ctx)

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: 'org_1',
        metadata: { organizationId: 'org_1' },
        // Without this the subscription arrives with no organization and every
        // later lifecycle event is ignored.
        subscription_data: { metadata: { organizationId: 'org_1' } },
      }),
    )
  })

  /**
   * `customer_creation` is a Checkout Session param that Stripe only accepts in
   * `mode: 'payment'` — sending it in `mode: 'subscription'` (this route's mode)
   * is a 400 `StripeInvalidRequestError`. Subscription mode creates a customer
   * automatically whenever none is passed, so the field is never needed here.
   */
  it('does not send customer_creation, which Stripe rejects in subscription mode', async () => {
    const { POST } = await import('../checkout/route')

    await POST(request(), ctx)

    const args = createSessionMock.mock.calls[0][0]
    expect(args.customer_creation).toBeUndefined()
    expect(args.customer).toBeUndefined()
  })

  /**
   * A second customer record for one organization splits invoices and payment
   * methods across two Stripe objects nobody can reconcile.
   */
  it('reuses an existing Stripe customer rather than minting a second', async () => {
    organizationFindUniqueMock.mockResolvedValue({ id: 'org_1', stripeCustomerId: 'cus_existing' })
    const { POST } = await import('../checkout/route')

    await POST(request(), ctx)

    const args = createSessionMock.mock.calls[0][0]
    expect(args.customer).toBe('cus_existing')
    expect(args.customer_creation).toBeUndefined()
  })

  /**
   * Absolute and operator-configured: deriving it from the request `Host`
   * would let anyone who controls that header choose where a paying customer
   * lands.
   */
  it('returns the customer to the configured origin, not the request host', async () => {
    const { POST } = await import('../checkout/route')

    await POST(request(), ctx)

    const args = createSessionMock.mock.calls[0][0]
    expect(args.success_url).toMatch(/^https:\/\/app\.example\.com\//)
    expect(args.cancel_url).toMatch(/^https:\/\/app\.example\.com\//)
  })

  it('refuses a plan that is not purchasable', async () => {
    planFindUniqueMock.mockResolvedValue({ ...PRO_PLAN, isPublic: false })
    const { POST } = await import('../checkout/route')

    expect((await POST(request({ organizationId: 'org_1', planCode: 'self_hosted' }), ctx)).status).toBe(400)
  })

  it('reports a plan with no configured price as unavailable rather than failing at Stripe', async () => {
    planFindUniqueMock.mockResolvedValue({ ...PRO_PLAN, stripePriceId: null })
    const { POST } = await import('../checkout/route')

    expect((await POST(request(), ctx)).status).toBe(503)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('reports a Stripe failure as 502 rather than leaking the error', async () => {
    createSessionMock.mockRejectedValue(new Error('Stripe is down'))
    const { POST } = await import('../checkout/route')

    const response = await POST(request(), ctx)
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.message).not.toMatch(/Stripe is down/)
  })
})

describe('POST /api/app/billing/checkout with the commercial layer off', () => {
  withConfigEnv({ USE_COMMERCIAL: 'false' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue(principalWithRole('owner'))
  })

  it('404s without touching Stripe', async () => {
    const { POST } = await import('../checkout/route')

    const response = await POST(request(), ctx)

    expect(response.status).toBe(404)
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})
