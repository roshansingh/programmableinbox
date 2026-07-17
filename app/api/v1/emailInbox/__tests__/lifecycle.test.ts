import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindUniqueMock = vi.fn()
const emailInboxUpdateMock = vi.fn()
const emailMessageUpdateManyMock = vi.fn()
const transactionMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUserMock(...args),
}))

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      create: (...args: unknown[]) => emailInboxCreateMock(...args),
      findUnique: (...args: unknown[]) => emailInboxFindUniqueMock(...args),
      findMany: vi.fn(),
      update: (...args: unknown[]) => emailInboxUpdateMock(...args),
    },
    emailMessage: {
      updateMany: (...args: unknown[]) => emailMessageUpdateManyMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

/** Shape of Prisma's unique-constraint violation. */
function uniqueViolation(target: string[]) {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } })
}

const USER = { id: 'user_1', memberships: [{ organizationId: 'org_1', role: 'owner' }] }

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  getAuthenticatedUserMock.mockResolvedValue(USER)
  transactionMock.mockResolvedValue([])
})

describe('POST /api/v1/emailInbox — address uniqueness (F1)', () => {
  async function post(body: unknown) {
    const { POST } = await import('../route')
    return POST(
      new Request('http://localhost/api/v1/emailInbox', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as never,
    )
  }

  it('409s when the address is already claimed, rather than 500ing', async () => {
    emailInboxCreateMock.mockRejectedValue(uniqueViolation(['email']))

    const response = await post({ organizationId: 'org_1', email: 'taken@example.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe('Email address is not available')
  })

  it('409s identically when the address is held by a soft-deleted inbox', async () => {
    // A deleted inbox keeps its address claimed, and the caller must not be
    // able to tell that apart from an address held by another tenant.
    emailInboxCreateMock.mockRejectedValue(uniqueViolation(['email']))

    const response = await post({ organizationId: 'org_1', email: 'deleted@example.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe('Email address is not available')
  })

  it('still 500s on unrelated failures', async () => {
    emailInboxCreateMock.mockRejectedValue(new Error('connection reset'))

    const response = await post({ organizationId: 'org_1', email: 'new@example.com' })

    expect(response.status).toBe(500)
  })

  it('creates the inbox when the address is free', async () => {
    emailInboxCreateMock.mockResolvedValue({ id: 'inbox_1', email: 'new@example.com' })

    const response = await post({ organizationId: 'org_1', email: 'new@example.com' })

    expect(response.status).toBe(201)
  })
})

describe('DELETE /api/v1/emailInbox/[id] — soft delete (F8)', () => {
  async function del(id: string) {
    const { DELETE } = await import('../[id]/route')
    return DELETE(new Request(`http://localhost/api/v1/emailInbox/${id}`, { method: 'DELETE' }) as never, {
      params: Promise.resolve({ id }),
    })
  }

  it('stamps deletedAt on the inbox and its messages instead of deleting rows', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

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

  it('hides the inbox and its messages atomically', async () => {
    // Both stamps go through one $transaction: a partial failure must not
    // leave the inbox visible with its messages gone, or vice versa.
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    await del('inbox_1')

    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2)
  })

  it('gives the inbox and its messages the same deletedAt', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' })

    await del('inbox_1')

    expect(emailMessageUpdateManyMock.mock.calls[0][0].data.deletedAt).toEqual(
      emailInboxUpdateMock.mock.calls[0][0].data.deletedAt,
    )
  })

  it('404s a foreign inbox without touching anything', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', userId: 'someone_else', organizationId: 'org_1' })

    const response = await del('inbox_1')

    expect(response.status).toBe(404)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('404s an already-deleted inbox — reads are filtered, so it is unreachable', async () => {
    // The soft-delete extension makes findUnique return null for a deleted row.
    emailInboxFindUniqueMock.mockResolvedValue(null)

    const response = await del('inbox_1')

    expect(response.status).toBe(404)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
