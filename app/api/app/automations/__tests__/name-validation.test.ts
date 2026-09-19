/**
 * Automation names are user-chosen labels shown in lists and headers, so
 * `POST` caps their length the same way `PATCH /[id]` does (see
 * `[id]/__tests__/route.test.ts`). Without it a create could store a name the
 * rename path would then refuse to save back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

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

function post(body: unknown) {
  return async () => {
    const { POST } = await import('../route')
    return POST(
      new NextRequest('http://localhost/api/app/automations', {
        method: 'POST',
        headers: { cookie: 'session=header.payload.signature' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    )
  }
}

describe('POST /api/app/automations — name validation', () => {
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

  it('accepts a name of exactly 100 characters, stored as given', async () => {
    const response = await post({ organizationId: 'org_1', name: 'a'.repeat(100) })()

    expect(response.status).toBe(201)
    expect(automationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'a'.repeat(100) }) }),
    )
  })

  it('rejects a name of 101 characters without creating anything', async () => {
    const response = await post({ organizationId: 'org_1', name: 'a'.repeat(101) })()
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toBe('name must be 100 characters or fewer')
    expect(automationCreateMock).not.toHaveBeenCalled()
  })

  it('measures the cap after trimming', async () => {
    const response = await post({
      organizationId: 'org_1',
      name: `  ${'a'.repeat(100)}  `,
    })()

    expect(response.status).toBe(201)
    expect(automationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'a'.repeat(100) }) }),
    )
  })
})
