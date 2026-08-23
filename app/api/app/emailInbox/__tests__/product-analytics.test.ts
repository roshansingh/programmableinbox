/**
 * Product analytics events fired from POST /api/app/emailInbox (issue #152):
 * inbox_created, second_inbox_created (when the org's live count reaches 2
 * on this creation), and plan_limit_denied (when createInbox's own plan-cap
 * check refuses the request).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailInboxCountMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      create: (...args: unknown[]) => emailInboxCreateMock(...args),
      findFirst: (...args: unknown[]) => emailInboxFindFirstMock(...args),
      findMany: vi.fn(),
      count: (...args: unknown[]) => emailInboxCountMock(...args),
    },
    emailMessage: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/ee/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: {
    inboxCreated: 'inbox_created',
    secondInboxCreated: 'second_inbox_created',
    planLimitDenied: 'plan_limit_denied',
  },
}))

const checkResourceLimitMock = vi.fn()

vi.mock('@/lib/commercial/enforce', () => ({
  checkResourceLimit: (...args: unknown[]) => checkResourceLimitMock(...args),
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'

const ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'free@corp.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(null)
  emailInboxCreateMock.mockResolvedValue(ROW)
  emailInboxCountMock.mockResolvedValue(1)
  checkResourceLimitMock.mockResolvedValue(null)
})

async function post(email = 'free@corp.com') {
  const { POST } = await import('../route')
  return POST(
    new NextRequest('http://localhost/api/app/emailInbox', {
      method: 'POST',
      headers: { authorization: TOKEN },
      body: JSON.stringify({ organizationId: 'org_1', email }),
    }),
    { params: Promise.resolve({}) },
  )
}

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false', EMAIL_INBOX_DOMAINS: 'corp.com' })

  it('creates the inbox without capturing anything or querying the count', async () => {
    const response = await post()

    expect(response.status).toBe(201)
    expect(captureEventMock).not.toHaveBeenCalled()
    expect(emailInboxCountMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
    EMAIL_INBOX_DOMAINS: 'corp.com',
  })

  it('captures inbox_created with the creator as distinct_id', async () => {
    emailInboxCountMock.mockResolvedValue(1)

    await post()

    expect(captureEventMock).toHaveBeenCalledWith(
      'inbox_created',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1', organizationId: 'org_1' }),
    )
  })

  it('also captures second_inbox_created when the org now has exactly two live inboxes', async () => {
    emailInboxCountMock.mockResolvedValue(2)

    await post()

    expect(captureEventMock).toHaveBeenCalledWith(
      'second_inbox_created',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1', organizationId: 'org_1' }),
    )
  })

  it('does not capture second_inbox_created for the first inbox', async () => {
    emailInboxCountMock.mockResolvedValue(1)

    await post()

    expect(captureEventMock).not.toHaveBeenCalledWith('second_inbox_created', expect.anything(), expect.anything())
  })

  it('does not capture second_inbox_created for the third inbox', async () => {
    emailInboxCountMock.mockResolvedValue(3)

    await post()

    expect(captureEventMock).not.toHaveBeenCalledWith('second_inbox_created', expect.anything(), expect.anything())
  })

  it('does not capture inbox_created when creation fails', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'other', email: 'free@corp.com' })

    const response = await post()

    expect(response.status).toBe(409)
    expect(captureEventMock).not.toHaveBeenCalledWith('inbox_created', expect.anything(), expect.anything())
  })

  it('captures plan_limit_denied, not inbox_created, when the plan cap refuses the request', async () => {
    checkResourceLimitMock.mockResolvedValue({
      message: 'Your Free plan allows 1 email inbox. Upgrade to add more.',
      status: 402,
      limit: 1,
      used: 1,
      planCode: 'free',
    })

    const response = await post()

    expect(response.status).toBe(402)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'emailInboxes', planCode: 'free' }),
    )
    expect(captureEventMock).not.toHaveBeenCalledWith('inbox_created', expect.anything(), expect.anything())
  })
})
