import { beforeEach, describe, expect, it, vi } from 'vitest'

const inboxFindFirstMock = vi.fn()
const inboxUpdateMock = vi.fn()
const messageFindFirstMock = vi.fn()
const messageUpdateMock = vi.fn()
const messageUpdateManyMock = vi.fn()
const transactionMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findFirst: (...a: unknown[]) => inboxFindFirstMock(...a),
      update: (...a: unknown[]) => inboxUpdateMock(...a),
    },
    emailMessage: {
      findFirst: (...a: unknown[]) => messageFindFirstMock(...a),
      update: (...a: unknown[]) => messageUpdateMock(...a),
      updateMany: (...a: unknown[]) => messageUpdateManyMock(...a),
    },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}))

const OWNER = { userId: 'user_1' }

describe('mutation services reject non-creators', () => {
  beforeEach(() => vi.resetAllMocks())

  it('deleteInbox refuses an inbox owned by someone else', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { deleteInbox } = await import('../email-inbox')

    expect(await deleteInbox(OWNER, 'inbox_1')).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('setMessageStarred refuses when the inbox is not owned', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { setMessageStarred } = await import('../email-inbox')

    expect(await setMessageStarred(OWNER, 'inbox_1', 'msg_1', true)).toBeNull()
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('deleteMessage refuses when the inbox is not owned', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { deleteMessage } = await import('../email-inbox')

    expect(await deleteMessage(OWNER, 'inbox_1', 'msg_1')).toBe(false)
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })
})

const READ_SCOPE = { organizationIds: ['org_1'], __scope: 'messageRead' as const }

describe('setMessageRead (issue #138)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('refuses when the inbox is outside the scope\'s organizations', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { setMessageRead } = await import('../email-inbox')

    expect(await setMessageRead(READ_SCOPE, 'inbox_1', 'msg_1', true)).toBeNull()
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('refuses a message belonging to a different inbox', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindFirstMock.mockResolvedValue(null)
    const { setMessageRead } = await import('../email-inbox')

    expect(await setMessageRead(READ_SCOPE, 'inbox_1', 'msg_1', true)).toBeNull()
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('resolves the inbox by organization membership, not by creator', async () => {
    // Unlike setMessageStarred's ownedInbox(owner, id) — {id, userId} — this
    // is {id, organizationId: {in: [...]}}, the same shape getInbox uses for
    // reads, so any org member reaches it regardless of who created the inbox.
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    messageFindFirstMock.mockResolvedValue({ id: 'msg_1' })
    messageUpdateMock.mockResolvedValue({ id: 'msg_1', isRead: true })
    const { setMessageRead } = await import('../email-inbox')

    const result = await setMessageRead(READ_SCOPE, 'inbox_1', 'msg_1', true)

    expect(inboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1'] } },
    })
    expect(messageUpdateMock).toHaveBeenCalledWith({
      where: { id: 'msg_1' },
      data: { isRead: true },
    })
    expect(result).toEqual({ id: 'msg_1', isRead: true })
  })
})

describe('deleteInbox', () => {
  beforeEach(() => vi.resetAllMocks())

  it('soft-deletes the inbox and its messages in one transaction', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', userId: 'user_1' })
    transactionMock.mockResolvedValue([])
    const { deleteInbox } = await import('../email-inbox')

    expect(await deleteInbox(OWNER, 'inbox_1')).toBe(true)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2)
  })
})
