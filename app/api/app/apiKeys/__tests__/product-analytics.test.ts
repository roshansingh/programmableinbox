/**
 * api_key_created and plan_limit_denied (issue #152), fired from
 * POST /api/app/apiKeys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const apiKeyCreateMock = vi.fn()
const apiKeyCountMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
      create: (...args: unknown[]) => apiKeyCreateMock(...args),
      count: (...args: unknown[]) => apiKeyCountMock(...args),
    },
  },
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { apiKeyCreated: 'api_key_created', planLimitDenied: 'plan_limit_denied' },
}))

const CREATED_KEY = {
  id: 'key_new',
  apiKey: null,
  keyHash: 'hash',
  prefix: 'sk_live_abcd',
  name: 'Partner Key',
  organizationId: 'org_1',
  userId: 'user_1',
  scopes: ['email_inboxes:read'],
  createdAt: new Date('2026-05-18T00:00:00.000Z'),
}

function post() {
  return new NextRequest('http://localhost/api/app/apiKeys', {
    method: 'POST',
    body: JSON.stringify({ organizationId: 'org_1', name: 'Partner Key', scopes: ['email_inboxes:read'] }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
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
  apiKeyCreateMock.mockResolvedValue(CREATED_KEY)
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('creates the key without capturing anything', async () => {
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

  it('captures api_key_created with the creator as distinct_id', async () => {
    const { POST } = await import('../route')

    await POST(post() as any, { params: Promise.resolve({}) })

    expect(captureEventMock).toHaveBeenCalledWith(
      'api_key_created',
      'user_1',
      expect.objectContaining({ apiKeyId: 'key_new', organizationId: 'org_1' }),
    )
  })

  it('captures plan_limit_denied, not api_key_created, once the org is at its key limit', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
    CommercialProvider.configure(
      {
        resolve: async () => ({
          planCode: 'free',
          planName: 'Free',
          limits: { ...UNLIMITED, apiKeys: 2 },
          periodStart: null,
          periodEnd: null,
        }),
      },
      CommercialProvider.quota,
      CommercialProvider.metering,
    )
    apiKeyCountMock.mockResolvedValue(2)

    const { POST } = await import('../route')
    const response = await POST(post() as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(402)
    expect(apiKeyCreateMock).not.toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'apiKeys', planCode: 'free' }),
    )
    expect(captureEventMock).not.toHaveBeenCalledWith('api_key_created', expect.anything(), expect.anything())

    CommercialProvider.reset()
  })

  it('does not capture when the request is rejected for bad input', async () => {
    const { POST } = await import('../route')
    const response = await POST(
      new NextRequest('http://localhost/api/app/apiKeys', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org_1', name: 'Bad Key', scopes: ['totally:wrong'] }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      }) as any,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(400)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
