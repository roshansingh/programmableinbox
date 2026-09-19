import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRevisionCreateMock = vi.fn()
const automationUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
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
    const request = new NextRequest('http://localhost/api/app/automations/automation_1', {
            method: 'PATCH',
      body: JSON.stringify({ name: '   ' }),
      headers: {
        'content-type': 'application/json',
        cookie: 'session=token',
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

  describe('renaming', () => {
    function patchName(name: string) {
      return async () => {
        const { PATCH } = await loadRoute()
        return PATCH(
          new NextRequest('http://localhost/api/app/automations/automation_1', {
            method: 'PATCH',
            body: JSON.stringify({ name }),
            headers: { 'content-type': 'application/json', cookie: 'session=token' },
          }) as any,
          { params: Promise.resolve({ id: 'automation_1' }) },
        )
      }
    }

    beforeEach(() => {
      // Echo what was written over the stored row, as Prisma would.
      automationUpdateMock.mockImplementation(async ({ data }: { data: object }) => ({
        ...(await automationFindFirstMock()),
        ...data,
      }))
    })

    it('saves the trimmed name without creating a revision', async () => {
      const response = await patchName('  Renamed automation  ')()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.name).toBe('Renamed automation')
      // A rename is not a graph edit: minting a revision would bump the
      // revision number and clutter history for a label change.
      expect(automationRevisionCreateMock).not.toHaveBeenCalled()
      expect(automationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Renamed automation', activeRevisionId: 'rev_1' },
        }),
      )
    })

    it('accepts a name of exactly 100 characters', async () => {
      const response = await patchName('a'.repeat(100))()

      expect(response.status).toBe(200)
      expect(automationUpdateMock).toHaveBeenCalledOnce()
    })

    it('rejects a name of 101 characters without writing', async () => {
      const response = await patchName('a'.repeat(101))()
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toBe('name must be 100 characters or fewer')
      expect(automationRevisionCreateMock).not.toHaveBeenCalled()
      expect(automationUpdateMock).not.toHaveBeenCalled()
    })

    it('measures the cap after trimming, so padding cannot push a valid name over it', async () => {
      const response = await patchName(`  ${'a'.repeat(100)}  `)()

      expect(response.status).toBe(200)
      expect(automationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'a'.repeat(100) }) }),
      )
    })
  })
})
