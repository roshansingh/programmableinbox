import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const constructEventMock = vi.fn()
const retrieveSubscriptionMock = vi.fn()
const updateSubscriptionMock = vi.fn()
const syncSubscriptionMock = vi.fn()

vi.mock('@/ee/billing/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEventMock(...a) },
    subscriptions: {
      retrieve: (...a: unknown[]) => retrieveSubscriptionMock(...a),
      update: (...a: unknown[]) => updateSubscriptionMock(...a),
    },
  }),
}))

vi.mock('@/ee/billing/subscription-sync', () => ({
  syncSubscriptionFromStripe: (...a: unknown[]) => syncSubscriptionMock(...a),
}))

function request(body = '{}', signature: string | null = 'v1,sig') {
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: signature
      ? { 'content-type': 'application/json', 'stripe-signature': signature }
      : { 'content-type': 'application/json' },
  })
}

const SUBSCRIPTION = { id: 'sub_1', status: 'active', metadata: { organizationId: 'org_1' } }

describe('POST /api/webhooks/stripe', () => {
  withConfigEnv({
    USE_COMMERCIAL: 'true',
    STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwx',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrstuvwx',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    syncSubscriptionMock.mockResolvedValue({ handled: true })
    retrieveSubscriptionMock.mockResolvedValue(SUBSCRIPTION)
    updateSubscriptionMock.mockResolvedValue(SUBSCRIPTION)
  })

  /**
   * Everything downstream trusts that the payload really came from Stripe. A
   * request that fails the MAC is attacker-controlled input and must not reach
   * a single write.
   */
  it('rejects a request whose signature does not verify', async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const { POST } = await import('../route')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(syncSubscriptionMock).not.toHaveBeenCalled()
  })

  it('rejects a request carrying no signature header at all', async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('missing signature')
    })
    const { POST } = await import('../route')

    const response = await POST(request('{}', null), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
  })

  /**
   * The signature covers the exact bytes Stripe sent, so verification has to
   * see the raw body — a re-serialised object fails even when identical.
   */
  it('verifies against the raw body', async () => {
    const raw = '{"id":"evt_1","type":"invoice.paid"}'
    constructEventMock.mockReturnValue({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } })
    const { POST } = await import('../route')

    await POST(request(raw), { params: Promise.resolve({}) })

    expect(constructEventMock).toHaveBeenCalledWith(raw, 'v1,sig', expect.any(String))
  })

  it('syncs on a subscription lifecycle event', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: SUBSCRIPTION },
    })
    const { POST } = await import('../route')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(syncSubscriptionMock).toHaveBeenCalledWith(SUBSCRIPTION)
  })

  /**
   * The session's copy of the subscription is a snapshot taken before payment
   * settled, and this object is what the entitlement decision rests on.
   */
  it('re-reads the subscription on checkout completion rather than trusting the session', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_3',
      type: 'checkout.session.completed',
      data: {
        object: { subscription: 'sub_1', metadata: { organizationId: 'org_1' }, client_reference_id: 'org_1' },
      },
    })
    const { POST } = await import('../route')

    await POST(request(), { params: Promise.resolve({}) })

    expect(retrieveSubscriptionMock).toHaveBeenCalledWith('sub_1')
    expect(syncSubscriptionMock).toHaveBeenCalled()
  })

  /**
   * Stripe does not copy session metadata onto the subscription, so without
   * this every later lifecycle event would arrive with no organization and be
   * ignored.
   */
  it('stamps the organization onto the subscription so later events carry it', async () => {
    retrieveSubscriptionMock.mockResolvedValue({ id: 'sub_1', status: 'active', metadata: {} })
    constructEventMock.mockReturnValue({
      id: 'evt_4',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_1', metadata: { organizationId: 'org_9' } } },
    })
    const { POST } = await import('../route')

    await POST(request(), { params: Promise.resolve({}) })

    expect(updateSubscriptionMock).toHaveBeenCalledWith('sub_1', {
      metadata: { organizationId: 'org_9' },
    })
  })

  /**
   * A 4xx here makes Stripe retry the same unhandleable event until it disables
   * the endpoint, taking every *other* event down with it.
   */
  it('acknowledges an event type it does not handle', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_5',
      type: 'customer.discount.created',
      data: { object: {} },
    })
    const { POST } = await import('../route')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(syncSubscriptionMock).not.toHaveBeenCalled()
  })

  /**
   * The one case where a retry is genuinely wanted: the failure is ours and
   * transient, so Stripe should come back.
   */
  it('returns 500 so Stripe retries when handling throws', async () => {
    syncSubscriptionMock.mockRejectedValue(new Error('database down'))
    constructEventMock.mockReturnValue({
      id: 'evt_6',
      type: 'customer.subscription.updated',
      data: { object: SUBSCRIPTION },
    })
    const { POST } = await import('../route')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
  })

  it('handles a replayed event without a second effect', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_7',
      type: 'customer.subscription.updated',
      data: { object: SUBSCRIPTION },
    })
    const { POST } = await import('../route')

    const first = await POST(request(), { params: Promise.resolve({}) })
    const second = await POST(request(), { params: Promise.resolve({}) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // Idempotency lives in the sync (upsert keyed on the organization), so the
    // route calls it both times and the end state is identical.
    expect(syncSubscriptionMock).toHaveBeenCalledTimes(2)
  })
})

describe('POST /api/webhooks/stripe with the commercial layer off', () => {
  withConfigEnv({ USE_COMMERCIAL: 'false' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  /**
   * 404 rather than 503: a feature that is off should not advertise that it
   * exists, matching `/api/mcp` under ENABLE_MCP.
   */
  it('404s without verifying anything', async () => {
    const { POST } = await import('../route')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(404)
    expect(constructEventMock).not.toHaveBeenCalled()
  })
})
