/**
 * webhook_created and plan_limit_denied (issue #152), fired from
 * POST /api/app/webhooks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const webhookCreateMock = vi.fn()
const webhookCountMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      findMany: vi.fn(),
      create: (...args: unknown[]) => webhookCreateMock(...args),
      count: (...args: unknown[]) => webhookCountMock(...args),
    },
  },
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { webhookCreated: 'webhook_created', planLimitDenied: 'plan_limit_denied' },
}))

const CREATED_WEBHOOK = {
  id: 'wh_1',
  name: 'My webhook',
  url: 'https://example.com/hook',
  events: ['email.received'],
  organizationId: 'org_1',
  secret: null,
}

function post() {
  return new NextRequest('http://localhost/api/app/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'My webhook', url: 'https://example.com/hook', events: ['email.received'] }),
    headers: { 'content-type': 'application/json', cookie: 'session=token' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue({
    kind: 'user',
    userId: 'user_1',
    memberships: [{ organizationId: 'org_1' }],
  })
  webhookCreateMock.mockResolvedValue(CREATED_WEBHOOK)
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('creates the webhook without capturing anything', async () => {
    const { POST } = await import('../route')

    const response = await POST(post() as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures webhook_created with the creator as distinct_id', async () => {
    const { POST } = await import('../route')

    await POST(post() as any, { params: Promise.resolve({}) })

    expect(captureEventMock).toHaveBeenCalledWith(
      'webhook_created',
      'user_1',
      expect.objectContaining({ webhookId: 'wh_1', organizationId: 'org_1' }),
    )
  })

  it('captures plan_limit_denied, not webhook_created, once the org is at its webhook limit', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
    CommercialProvider.configure(
      {
        resolve: async () => ({
          planCode: 'free',
          planName: 'Free',
          limits: { ...UNLIMITED, webhooks: 1 },
          periodStart: null,
          periodEnd: null,
        }),
      },
      CommercialProvider.quota,
      CommercialProvider.metering,
    )
    webhookCountMock.mockResolvedValue(1)

    const { POST } = await import('../route')
    const response = await POST(post() as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(402)
    expect(webhookCreateMock).not.toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'webhooks', planCode: 'free' }),
    )
    expect(captureEventMock).not.toHaveBeenCalledWith('webhook_created', expect.anything(), expect.anything())

    CommercialProvider.reset()
  })

  it('does not capture when the request is rejected for missing fields', async () => {
    const { POST } = await import('../route')
    const response = await POST(
      new NextRequest('http://localhost/api/app/webhooks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Missing url and events' }),
        headers: { 'content-type': 'application/json', cookie: 'session=token' },
      }) as any,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(400)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
