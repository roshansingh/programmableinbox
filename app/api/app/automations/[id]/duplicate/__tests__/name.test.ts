/**
 * A duplicate is named "<name> Copy". Names are capped at
 * MAX_AUTOMATION_NAME_LENGTH (100) on create and rename, so the copy of a
 * name near the cap must be shortened to fit rather than stored over it —
 * otherwise the cap is one Duplicate click away from being bypassed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

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

async function duplicateNamed(name: string) {
  const config = createDefaultAutomationConfig()
  const layout = createDefaultAutomationLayout(config)
  automationFindFirstMock.mockResolvedValue({
    id: 'automation_1',
    organizationId: 'org_1',
    inboxId: null,
    name,
    description: null,
    isActive: false,
    activeRevisionId: 'rev_1',
    activeRevision: { id: 'rev_1', revision: 1, schemaVersion: config.version, config, layout },
    revisions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const { POST } = await import('../route')
  const response = await POST(
    new NextRequest('http://localhost/api/app/automations/automation_1/duplicate', {
      method: 'POST',
      headers: { cookie: 'session=token' },
    }),
    { params: Promise.resolve({ id: 'automation_1' }) },
  )
  expect(response.status).toBe(201)
  return automationCreateMock.mock.calls[0][0].data.name as string
}

describe('POST /api/app/automations/[id]/duplicate — copy name', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    automationCreateMock.mockResolvedValue({
      id: 'automation_2',
      revisions: [{ id: 'rev_2', revision: 1 }],
    })
    automationUpdateMock.mockResolvedValue({
      id: 'automation_2',
      activeRevisionId: 'rev_2',
      activeRevision: null,
      revisions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it('appends " Copy" to an ordinary name', async () => {
    expect(await duplicateNamed('Route support email')).toBe('Route support email Copy')
  })

  it('keeps a name that leaves room for the suffix whole, up to exactly 100 characters', async () => {
    const name = 'a'.repeat(95)

    expect(await duplicateNamed(name)).toBe(`${'a'.repeat(95)} Copy`)
  })

  it('shortens a 100-character name so the copy is still 100 characters', async () => {
    const copyName = await duplicateNamed('a'.repeat(100))

    expect(copyName).toBe(`${'a'.repeat(95)} Copy`)
    expect(copyName).toHaveLength(100)
  })

  it('does not leave a stray space before the suffix when the cut lands on one', async () => {
    // 94 x "a", one space, 5 x "b" = 100 characters; the cut at 95 keeps the space.
    const copyName = await duplicateNamed(`${'a'.repeat(94)} ${'b'.repeat(5)}`)

    expect(copyName).toBe(`${'a'.repeat(94)} Copy`)
  })
})
