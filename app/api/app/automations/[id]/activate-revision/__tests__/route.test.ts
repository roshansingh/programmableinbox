import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRevisionFindFirstMock = vi.fn()
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
      findFirst: (...args: unknown[]) => automationRevisionFindFirstMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('POST /api/app/automations/[id]/activate-revision', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
  })

  it('rejects switching an active automation to a revision that cannot start', async () => {
    const currentConfig = createDefaultAutomationConfig()
    const currentLayout = createDefaultAutomationLayout(currentConfig)
    const invalidConfig = createDefaultAutomationConfig()
    invalidConfig.nodes = invalidConfig.nodes.filter((node) => node.type !== 'action')
    invalidConfig.edges = invalidConfig.edges.filter((edge) => edge.targetNodeId !== 'action_webhook')
    const invalidLayout = createDefaultAutomationLayout(invalidConfig)

    automationFindFirstMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Test automation',
      description: null,
      isActive: true,
      activeRevisionId: 'rev_current',
      activeRevision: {
        id: 'rev_current',
        revision: 1,
        schemaVersion: 1,
        config: currentConfig,
        layout: currentLayout,
      },
      revisions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    automationRevisionFindFirstMock.mockResolvedValue({
      id: 'rev_invalid',
      automationId: 'automation_1',
      revision: 2,
      schemaVersion: 1,
      config: invalidConfig,
      layout: invalidLayout,
    })
    automationUpdateMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Test automation',
      description: null,
      isActive: true,
      activeRevisionId: 'rev_invalid',
      activeRevision: {
        id: 'rev_invalid',
        revision: 2,
        schemaVersion: 1,
        config: invalidConfig,
        layout: invalidLayout,
      },
      revisions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { POST } = await loadRoute()
    const request = new Request('http://localhost/api/app/automations/automation_1/activate-revision', {
      headers: { authorization: 'Bearer jwt.token.here' },
      method: 'POST',
      body: JSON.stringify({ revisionId: 'rev_invalid' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
    })

    const response = await POST(request as any, {
      params: Promise.resolve({ id: 'automation_1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/not ready to start|reachable action/i)
    expect(automationUpdateMock).not.toHaveBeenCalled()
  })
})
