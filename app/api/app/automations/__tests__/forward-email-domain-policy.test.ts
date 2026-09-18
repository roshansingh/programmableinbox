/**
 * A `forward_email` action pointed at a domain this deployment owns
 * (`EMAIL_INBOX_ALLOWED_DOMAINS`) never leaves the platform — forwarding
 * there is a way to mint a free address or loop mail back into our own
 * inbound pipeline. Rejected at save time (POST here, PATCH in
 * `[id]/__tests__/forward-email-domain-policy.test.ts`) so a user cannot
 * save an automation that will silently fail every run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { createDefaultAutomationConfig } from '@/lib/automations/definitions'
import type { AutomationConfig } from '@/lib/automations/types'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationCreateMock = vi.fn()
const automationUpdateMock = vi.fn()
const resolvePlanMock = vi.fn()
const checkResourceLimitMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) => resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      create: (...a: unknown[]) => automationCreateMock(...a),
      update: (...a: unknown[]) => automationUpdateMock(...a),
    },
    emailInbox: { findFirst: vi.fn() },
  },
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

/**
 * Swaps the default config's `action_webhook` node for a `forward_email`
 * node, keeping the id (and therefore the existing edge into it) so the
 * graph stays connected without hand-building edges.
 */
function forwardEmailConfig(to: string[]): AutomationConfig {
  const base = createDefaultAutomationConfig()
  return {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === 'action_webhook'
        ? {
            id: 'action_webhook',
            type: 'action' as const,
            version: 1 as const,
            actionType: 'forward_email' as const,
            config: { type: 'forward_email_config' as const, version: 1 as const, to },
          }
        : node,
    ),
  }
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

describe('POST /api/app/automations — forward_email domain policy', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
    automationCreateMock.mockResolvedValue({
      id: 'automation_1',
      revisions: [{ id: 'rev_1', revision: 1 }],
    })
    automationUpdateMock.mockResolvedValue({
      id: 'automation_1',
      activeRevisionId: 'rev_1',
      activeRevision: null,
      revisions: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    checkResourceLimitMock.mockResolvedValue(null)
    resolvePlanMock.mockResolvedValue({
      planCode: 'self_hosted',
      planName: 'Self-hosted',
      limits: { automationsEnabled: true, automations: null },
    })
  })

  it('rejects a forward_email node whose "to" targets a domain this deployment owns', async () => {
    const response = await post({
      organizationId: 'org_1',
      name: 'My automation',
      config: forwardEmailConfig(['abuse@inbox.example.com']),
    })()

    expect(response.status).toBe(400)
    expect(automationCreateMock).not.toHaveBeenCalled()
  })

  it('allows a forward_email node targeting an external address', async () => {
    const response = await post({
      organizationId: 'org_1',
      name: 'My automation',
      config: forwardEmailConfig(['dest@gmail.com']),
    })()

    expect(response.status).toBe(201)
    expect(automationCreateMock).toHaveBeenCalled()
  })
})
