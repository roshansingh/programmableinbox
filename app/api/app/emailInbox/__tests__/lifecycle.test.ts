/**
 * Inbox lifecycle: address uniqueness on create (F1) and soft delete (F8).
 *
 * Ported from the v1 suite when these routes moved to /api/app. Two structural
 * changes from the original:
 *
 *   - Auth is withUser, so the seam is resolveUserPrincipalFromToken.
 *   - Ownership now resolves through prisma.emailInbox.findFirst constrained by
 *     userId (inside the mutation service) rather than a findUnique followed by
 *     an in-handler `inbox.userId !== user.id` comparison. The service has no
 *     path that mutates a row it did not first prove is owned, so "foreign
 *     inbox" is expressed as the lookup returning null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailInboxUpdateMock = vi.fn()
const emailMessageUpdateManyMock = vi.fn()
const transactionMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      create: (...args: unknown[]) => emailInboxCreateMock(...args),
      findFirst: (...args: unknown[]) => emailInboxFindFirstMock(...args),
      findMany: vi.fn(),
      update: (...args: unknown[]) => emailInboxUpdateMock(...args),
    },
    emailMessage: {
      updateMany: (...args: unknown[]) => emailMessageUpdateManyMock(...args),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['email'] },
  })
}

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'
const UNAVAILABLE = 'Email address is not available'

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(null)
  transactionMock.mockResolvedValue([])
})

describe('POST /api/app/emailInbox — address uniqueness (F1)', () => {
  async function post(email: string) {
    const { POST } = await import('../route')
    return POST(
      new NextRequest('http://localhost/api/app/emailInbox', {
        method: 'POST',
        headers: { authorization: TOKEN },
        body: JSON.stringify({ organizationId: 'org_1', email }),
      }),
      { params: Promise.resolve({}) },
    )
  }

  it('409s when the address is already claimed, rather than 500ing', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'other', email: 'taken@corp.com' })

    const response = await post('taken@corp.com')

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('409s identically when the address is held by a soft-deleted inbox', async () => {
    // Reads are soft-delete filtered, so the pre-check misses it and the unique
    // index raises. The two cases must be indistinguishable to the caller.
    emailInboxFindFirstMock.mockResolvedValue(null)
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post('taken@corp.com')

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('still 500s on unrelated failures', async () => {
    emailInboxCreateMock.mockRejectedValue(new Error('connection lost'))

    const response = await post('free@corp.com')

    expect(response.status).toBe(500)
  })

  it('creates the inbox when the address is free', async () => {
    emailInboxCreateMock.mockResolvedValue({
      id: 'inbox_1',
      organizationId: 'org_1',
      userId: 'user_1',
      email: 'free@corp.com',
      name: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const response = await post('free@corp.com')

    expect(response.status).toBe(201)
    expect((await response.json()).data.email).toBe('free@corp.com')
  })
})

describe('DELETE /api/app/emailInbox/[id] — soft delete (F8)', () => {
  async function del(id: string) {
    const { DELETE } = await import('../[id]/route')
    return DELETE(
      new NextRequest(`http://localhost/api/app/emailInbox/${id}`, {
        method: 'DELETE',
        headers: { authorization: TOKEN },
      }),
      { params: Promise.resolve({ id }) },
    )
  }

  it('stamps deletedAt on the inbox and its messages instead of deleting rows', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    const response = await del('inbox_1')

    expect(response.status).toBe(204)
    expect(emailMessageUpdateManyMock).toHaveBeenCalledWith({
      where: { inboxEmailAddressId: 'inbox_1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(emailInboxUpdateMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1' },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('resolves ownership with a userId-constrained lookup', async () => {
    // Creator-only mutation: the constraint is in the query, so there is no
    // path that loads a row it may not mutate.
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    await del('inbox_1')

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', userId: 'user_1' },
    })
  })

  it('hides the inbox and its messages atomically', async () => {
    // Both stamps go through one $transaction: a partial failure must not
    // leave the inbox visible with its messages gone, or vice versa.
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    await del('inbox_1')

    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2)
  })

  it('gives the inbox and its messages the same deletedAt', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    await del('inbox_1')

    expect(emailMessageUpdateManyMock.mock.calls[0][0].data.deletedAt).toEqual(
      emailInboxUpdateMock.mock.calls[0][0].data.deletedAt,
    )
  })

  it('404s a foreign inbox without touching anything', async () => {
    // Owned by someone else, so the userId-constrained lookup returns nothing.
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await del('inbox_1')

    expect(response.status).toBe(404)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('404s an already-deleted inbox — reads are filtered, so it is unreachable', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await del('inbox_1')

    expect(response.status).toBe(404)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects an API key without a database lookup', async () => {
    const { DELETE } = await import('../[id]/route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/app/emailInbox/inbox_1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer sk_live_abcdef123456' },
      }),
      { params: Promise.resolve({ id: 'inbox_1' }) },
    )

    expect(response.status).toBe(401)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
