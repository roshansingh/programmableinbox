import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRevisionCreateMock = vi.fn()
const automationUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
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

async function loadRoute() {
  return await import('../route')
}

describe('PATCH /api/app/automations/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })

    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)
    automationFindFirstMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Existing name',
      description: null,
      isActive: false,
      activeRevisionId: 'rev_1',
      activeRevision: {
        id: 'rev_1',
        revision: 1,
        schemaVersion: 1,
        config,
        layout,
      },
      revisions: [
        {
          id: 'rev_1',
          revision: 1,
          schemaVersion: 1,
          config,
          layout,
          createdAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it('rejects blank names', async () => {
    const { PATCH } = await loadRoute()
    const request = new Request('http://localhost/api/app/automations/automation_1', {
            method: 'PATCH',
      body: JSON.stringify({ name: '   ' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
    })

    const response = await PATCH(request as any, {
      params: Promise.resolve({ id: 'automation_1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toBe('name must not be empty')
    expect(automationRevisionCreateMock).not.toHaveBeenCalled()
    expect(automationUpdateMock).not.toHaveBeenCalled()
  })
})
