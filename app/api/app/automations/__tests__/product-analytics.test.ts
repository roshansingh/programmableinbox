/**
 * automation_created and plan_limit_denied (issue #152), fired from
 * POST /api/app/automations. Two distinct denial paths feed
 * plan_limit_denied here: the automationsEnabled feature gate (checked
 * first) and the count-cap via checkResourceLimit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationCreateMock = vi.fn()
const automationUpdateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const captureEventMock = vi.fn()
const checkResourceLimitMock = vi.fn()
const resolvePlanMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      findMany: vi.fn(),
      create: (...a: unknown[]) => automationCreateMock(...a),
      update: (...a: unknown[]) => automationUpdateMock(...a),
    },
    emailInbox: { findFirst: (...a: unknown[]) => emailInboxFindFirstMock(...a) },
  },
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { automationCreated: 'automation_created', planLimitDenied: 'plan_limit_denied' },
}))

vi.mock('@/lib/commercial/enforce', () => ({
  checkResourceLimit: (...args: unknown[]) => checkResourceLimitMock(...args),
}))

vi.mock('@/lib/commercial/provider', () => ({
  CommercialProvider: {
    plans: { resolve: (...args: unknown[]) => resolvePlanMock(...args) },
  },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'header.payload.signature'

const DEFAULT_CONFIG = createDefaultAutomationConfig()
const DEFAULT_LAYOUT = createDefaultAutomationLayout(DEFAULT_CONFIG)

const CREATED = {
  id: 'automation_1',
  organizationId: 'org_1',
  inboxId: null,
  name: 'My automation',
  description: null,
  isActive: false,
  activeRevisionId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  revisions: [
    {
      id: 'rev_1',
      revision: 1,
      schemaVersion: DEFAULT_CONFIG.version,
      config: DEFAULT_CONFIG,
      layout: DEFAULT_LAYOUT,
      createdAt: new Date(),
    },
  ],
}

const FINALIZED = {
  ...CREATED,
  activeRevisionId: 'rev_1',
  activeRevision: CREATED.revisions[0],
}

function post(body: unknown) {
  return async () => {
    const { POST } = await import('../route')
    return POST(
      new NextRequest('http://localhost/api/app/automations', {
        method: 'POST',
        headers: { cookie: `session=${TOKEN}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    )
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  automationCreateMock.mockResolvedValue(CREATED)
  automationUpdateMock.mockResolvedValue(FINALIZED)
  checkResourceLimitMock.mockResolvedValue(null)
  resolvePlanMock.mockResolvedValue({
    planCode: 'self_hosted',
    planName: 'Self-hosted',
    limits: { automationsEnabled: true, automations: null },
  })
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('creates the automation without capturing anything', async () => {
    const response = await post({ organizationId: 'org_1', name: 'My automation' })()

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

  it('captures automation_created with the creator as distinct_id', async () => {
    const response = await post({ organizationId: 'org_1', name: 'My automation' })()

    expect(response.status).toBe(201)
    expect(captureEventMock).toHaveBeenCalledWith(
      'automation_created',
      'user_1',
      expect.objectContaining({ automationId: 'automation_1', organizationId: 'org_1' }),
    )
  })

  it('captures plan_limit_denied when the plan does not include automations at all', async () => {
    resolvePlanMock.mockResolvedValue({
      planCode: 'free',
      planName: 'Free',
      limits: { automationsEnabled: false, automations: 0 },
    })

    const response = await post({ organizationId: 'org_1', name: 'My automation' })()

    expect(response.status).toBe(402)
    expect(automationCreateMock).not.toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'automations', planCode: 'free' }),
    )
    expect(captureEventMock).not.toHaveBeenCalledWith('automation_created', expect.anything(), expect.anything())
  })

  it('captures plan_limit_denied when the automation count cap is hit', async () => {
    checkResourceLimitMock.mockResolvedValue({
      message: 'Your Pro plan allows 5 automations. Upgrade to add more.',
      status: 402,
      limit: 5,
      used: 5,
      planCode: 'pro',
    })

    const response = await post({ organizationId: 'org_1', name: 'My automation' })()

    expect(response.status).toBe(402)
    expect(automationCreateMock).not.toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'automations', planCode: 'pro' }),
    )
  })

  it('does not capture automation_created when the request is malformed', async () => {
    const response = await post({ organizationId: 'org_1' })()

    expect(response.status).toBe(400)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
