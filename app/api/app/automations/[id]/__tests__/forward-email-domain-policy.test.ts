/**
 * Same rule as `../../__tests__/forward-email-domain-policy.test.ts`, applied
 * to updating an automation's config, not just creating one — without this, a
 * `forward_email` node targeting a same-service domain could be added later
 * via PATCH even though POST refuses it at creation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import type { AutomationConfig } from '@/lib/automations/types'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRevisionCreateMock = vi.fn()
const automationUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) => resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      findFirst: (...args: unknown[]) => automationFindFirstMock(...args),
      update: (...args: unknown[]) => automationUpdateMock(...args),
    },
    automationRevision: {
      create: (...args: unknown[]) => automationRevisionCreateMock(...args),
    },
  },
}))

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

async function loadRoute() {
  return await import('../route')
}

function patch(body: unknown) {
  return async () => {
    const { PATCH } = await loadRoute()
    return PATCH(
      new NextRequest('http://localhost/api/app/automations/automation_1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: 'session=token' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'automation_1' }) },
    )
  }
}

describe('PATCH /api/app/automations/[id] — forward_email domain policy', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })

    const existingConfig = createDefaultAutomationConfig()
    const existingLayout = createDefaultAutomationLayout(existingConfig)
    automationFindFirstMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Existing name',
      description: null,
      isActive: false,
      activeRevisionId: 'rev_1',
      activeRevision: { id: 'rev_1', revision: 1, schemaVersion: 1, config: existingConfig, layout: existingLayout },
      revisions: [{ id: 'rev_1', revision: 1, schemaVersion: 1, config: existingConfig, layout: existingLayout, createdAt: new Date() }],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    automationRevisionCreateMock.mockResolvedValue({ id: 'rev_2' })
    automationUpdateMock.mockResolvedValue({
      id: 'automation_1',
      activeRevisionId: 'rev_2',
      activeRevision: null,
      revisions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it('rejects a forward_email node whose "to" targets a domain this deployment owns', async () => {
    const response = await patch({ config: forwardEmailConfig(['abuse@inbox.example.com']) })()

    expect(response.status).toBe(400)
    expect(automationRevisionCreateMock).not.toHaveBeenCalled()
    expect(automationUpdateMock).not.toHaveBeenCalled()
  })

  it('allows a forward_email node targeting an external address', async () => {
    const response = await patch({ config: forwardEmailConfig(['dest@gmail.com']) })()

    expect(response.status).toBe(200)
    expect(automationRevisionCreateMock).toHaveBeenCalled()
  })
})
