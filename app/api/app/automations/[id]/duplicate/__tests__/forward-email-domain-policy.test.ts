/**
 * `POST .../automations/[id]/duplicate` copies `activeRevision.config`
 * verbatim (`app/api/app/automations/[id]/duplicate/route.ts`), bypassing
 * the save-time forward_email domain check that POST/PATCH enforce
 * (`../../__tests__/forward-email-domain-policy.test.ts` and
 * `../../[id]/__tests__/forward-email-domain-policy.test.ts`). An automation
 * saved before this rule existed — or containing a node whose target domain
 * was added to EMAIL_INBOX_ALLOWED_DOMAINS afterward — could otherwise be
 * duplicated with the violation intact, forever, with no path back through
 * validation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import type { AutomationConfig } from '@/lib/automations/types'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationCreateMock = vi.fn()
const automationUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) => resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      findFirst: (...args: unknown[]) => automationFindFirstMock(...args),
      create: (...args: unknown[]) => automationCreateMock(...args),
      update: (...args: unknown[]) => automationUpdateMock(...args),
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

async function duplicate() {
  const { POST } = await import('../route')
  return POST(
    new NextRequest('http://localhost/api/app/automations/automation_1/duplicate', {
      method: 'POST',
      headers: { cookie: 'session=token' },
    }),
    { params: Promise.resolve({ id: 'automation_1' }) },
  )
}

describe('POST /api/app/automations/[id]/duplicate — forward_email domain policy', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    automationCreateMock.mockResolvedValue({ id: 'automation_2', revisions: [{ id: 'rev_2', revision: 1 }] })
    automationUpdateMock.mockResolvedValue({
      id: 'automation_2',
      activeRevisionId: 'rev_2',
      activeRevision: null,
      revisions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  function existingAutomation(config: AutomationConfig) {
    const layout = createDefaultAutomationLayout(config)
    return {
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Existing',
      description: null,
      isActive: false,
      activeRevisionId: 'rev_1',
      activeRevision: { id: 'rev_1', revision: 1, schemaVersion: config.version, config, layout },
      revisions: [{ id: 'rev_1', revision: 1, schemaVersion: config.version, config, layout, createdAt: new Date() }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  it('refuses to duplicate an automation whose forward_email node targets a domain this deployment owns', async () => {
    automationFindFirstMock.mockResolvedValue(existingAutomation(forwardEmailConfig(['abuse@inbox.example.com'])))

    const response = await duplicate()

    expect(response.status).toBe(400)
    expect(automationCreateMock).not.toHaveBeenCalled()
  })

  it('still duplicates an automation targeting an external address', async () => {
    automationFindFirstMock.mockResolvedValue(existingAutomation(forwardEmailConfig(['dest@gmail.com'])))

    const response = await duplicate()

    expect(response.status).toBe(201)
    expect(automationCreateMock).toHaveBeenCalled()
  })
})
