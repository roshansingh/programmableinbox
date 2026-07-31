import { beforeEach, describe, expect, it, vi } from 'vitest'

const findManyMock = vi.fn()
const findFirstMock = vi.fn()
const messageFindManyMock = vi.fn()
const messageFindFirstMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    emailMessage: {
      findMany: (...args: unknown[]) => messageFindManyMock(...args),
      findFirst: (...args: unknown[]) => messageFindFirstMock(...args),
    },
  },
}))

const SCOPE = { organizationIds: ['org_1', 'org_2'] }

describe('listInboxes', () => {
  beforeEach(() => vi.resetAllMocks())

  it('scopes the query to the organizations in the scope', async () => {
    findManyMock.mockResolvedValue([])
    const { listInboxes } = await import('../email-inbox')

    await listInboxes(SCOPE)

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['org_1', 'org_2'] } },
      }),
    )
  })

  it('orders deterministically so the row ceiling truncates stably', async () => {
    findManyMock.mockResolvedValue([])
    const { listInboxes } = await import('../email-inbox')

    await listInboxes(SCOPE)

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('never scopes by userId', async () => {
    findManyMock.mockResolvedValue([])
    const { listInboxes } = await import('../email-inbox')

    await listInboxes(SCOPE)

    const where = findManyMock.mock.calls[0][0].where
    expect(where).not.toHaveProperty('userId')
  })
})

describe('getInbox', () => {
  beforeEach(() => vi.resetAllMocks())

  it('constrains the lookup by organization, not just id', async () => {
    findFirstMock.mockResolvedValue(null)
    const { getInbox } = await import('../email-inbox')

    await getInbox(SCOPE, 'inbox_1')

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1', 'org_2'] } },
    })
  })

  it('returns null for an inbox outside the scope', async () => {
    findFirstMock.mockResolvedValue(null)
    const { getInbox } = await import('../email-inbox')

    expect(await getInbox(SCOPE, 'other_org_inbox')).toBeNull()
  })
})

describe('getMessage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns null when the inbox is outside the scope', async () => {
    findFirstMock.mockResolvedValue(null)
    const { getMessage } = await import('../email-inbox')

    expect(await getMessage(SCOPE, 'inbox_1', 'msg_1')).toBeNull()
    expect(messageFindFirstMock).not.toHaveBeenCalled()
  })

  it('constrains the message to the inbox', async () => {
    findFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindFirstMock.mockResolvedValue(null)
    const { getMessage } = await import('../email-inbox')

    await getMessage(SCOPE, 'inbox_1', 'msg_1')

    expect(messageFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'msg_1', inboxEmailAddressId: 'inbox_1' },
    })
  })
})

describe('listMessages ordering', () => {
  beforeEach(() => vi.resetAllMocks())

  it('sorts a flat inbox list newest first', async () => {
    findFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindManyMock.mockResolvedValue([])
    const { listMessages } = await import('../email-inbox')

    await listMessages(SCOPE, 'inbox_1', { limit: 20, cursor: null })

    expect(messageFindManyMock.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('sorts a single-thread view oldest first', async () => {
    findFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindManyMock.mockResolvedValue([])
    const { listMessages } = await import('../email-inbox')

    await listMessages(SCOPE, 'inbox_1', { limit: 20, cursor: null, threadId: 'thread_1' })

    expect(messageFindManyMock.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ])
  })

  it('flips the cursor comparison to match the sort direction', async () => {
    findFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindManyMock.mockResolvedValue([])
    const { listMessages } = await import('../email-inbox')

    // epochMs is part of DecodedCursor — the grouped raw-SQL path compares on
    // it to stay timezone-independent. The flat path below reads only
    // createdAt/id, but the cursor still has to be a well-formed one.
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    const cursor = { createdAt, epochMs: createdAt.getTime(), id: 'msg_5' }

    await listMessages(SCOPE, 'inbox_1', { limit: 20, cursor, threadId: 'thread_1' })
    expect(messageFindManyMock.mock.calls[0][0].where.OR[0]).toEqual({
      createdAt: { gt: cursor.createdAt },
    })

    vi.resetAllMocks()
    findFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindManyMock.mockResolvedValue([])

    await listMessages(SCOPE, 'inbox_1', { limit: 20, cursor })
    expect(messageFindManyMock.mock.calls[0][0].where.OR[0]).toEqual({
      createdAt: { lt: cursor.createdAt },
    })
  })
})
