/**
 * Ported from the v1 suite when these routes moved to /api/app.
 *
 * The API-key cases from the original are gone: this tree is JWT-only, and the
 * key path is covered by the /api/v1 suite instead. What replaces them is the
 * assertion that a key is rejected here outright.
 *
 * The listing is now organization-scoped rather than user-scoped, so a member
 * sees inboxes created by colleagues. isOwner is what the UI gates actions on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindManyMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findMany: (...args: unknown[]) => emailInboxFindManyMock(...args),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    emailMessage: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [
    { organizationId: 'org_1', role: 'owner' },
    { organizationId: 'org_2', role: 'member' },
  ],
}

const TOKEN = 'Bearer header.payload.signature'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inbox_1',
    organizationId: 'org_1',
    userId: 'user_1',
    email: 'a@example.com',
    name: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindManyMock.mockResolvedValue([])
})

async function get(url = 'http://localhost/api/app/emailInbox', authorization = TOKEN) {
  const { GET } = await import('../route')
  return GET(
    new NextRequest(url, { headers: authorization ? { authorization } : {} }),
    { params: Promise.resolve({}) },
  )
}

describe('GET /api/app/emailInbox', () => {
  it('returns 401 without authentication', async () => {
    const { GET } = await import('../route')
    const response = await GET(new NextRequest('http://localhost/api/app/emailInbox'), {
      params: Promise.resolve({}) ,
    })

    expect(response.status).toBe(401)
  })

  it('lists inboxes across every organization the user belongs to', async () => {
    emailInboxFindManyMock.mockResolvedValue([row()])

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(emailInboxFindManyMock.mock.calls[0][0].where).toEqual({
      organizationId: { in: ['org_1', 'org_2'] },
    })
    expect(body.data).toHaveLength(1)
  })

  it('never scopes the listing by userId', async () => {
    // Reads widened from creator-only to organization-wide. Scoping by userId
    // here would hide colleagues' inboxes the member is entitled to see.
    await get()

    expect(emailInboxFindManyMock.mock.calls[0][0].where).not.toHaveProperty('userId')
  })

  it('narrows to a requested organization the user belongs to', async () => {
    await get('http://localhost/api/app/emailInbox?organizationId=org_2')

    expect(emailInboxFindManyMock.mock.calls[0][0].where).toEqual({
      organizationId: { in: ['org_2'] },
    })
  })

  it('returns 403 when user is not member of requested organization', async () => {
    const response = await get('http://localhost/api/app/emailInbox?organizationId=org_other')

    expect(response.status).toBe(403)
    expect(emailInboxFindManyMock).not.toHaveBeenCalled()
  })

  it('marks the creator as owner and a colleague as not', async () => {
    emailInboxFindManyMock.mockResolvedValue([
      row({ id: 'mine', userId: 'user_1' }),
      row({ id: 'theirs', userId: 'user_2' }),
    ])

    const body = await (await get()).json()

    expect(body.data[0].isOwner).toBe(true)
    expect(body.data[1].isOwner).toBe(false)
  })

  it('does not expose the creating user id', async () => {
    emailInboxFindManyMock.mockResolvedValue([row({ userId: 'user_2' })])

    const body = await (await get()).json()

    expect(body.data[0]).not.toHaveProperty('userId')
  })

  it('rejects an API key without attempting JWT verification', async () => {
    const response = await get('http://localhost/api/app/emailInbox', 'Bearer sk_live_abcdef123456')

    expect(response.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
    expect(emailInboxFindManyMock).not.toHaveBeenCalled()
  })
})
