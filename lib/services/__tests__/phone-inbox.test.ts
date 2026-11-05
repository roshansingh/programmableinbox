import { beforeEach, describe, expect, it, vi } from 'vitest'

const findManyMock = vi.fn()
const findFirstMock = vi.fn()
const countMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    phoneInbox: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}))

const SCOPE = { organizationIds: ['org_1', 'org_2'] }
const LIVE = { in: ['pending', 'active'] }

describe('listPhoneInboxes', () => {
  beforeEach(() => vi.resetAllMocks())

  it('scopes to the scope organizations and to live numbers only', async () => {
    findManyMock.mockResolvedValue([])
    const { listPhoneInboxes } = await import('../phone-inbox')

    await listPhoneInboxes(SCOPE)

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['org_1', 'org_2'] }, status: LIVE },
      }),
    )
  })

  it('orders deterministically so the row ceiling truncates stably', async () => {
    findManyMock.mockResolvedValue([])
    const { listPhoneInboxes } = await import('../phone-inbox')

    await listPhoneInboxes(SCOPE)

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 }),
    )
  })
})

describe('getPhoneInbox', () => {
  beforeEach(() => vi.resetAllMocks())

  it('looks the row up by id inside the scope, live numbers only', async () => {
    findFirstMock.mockResolvedValue(null)
    const { getPhoneInbox } = await import('../phone-inbox')

    const result = await getPhoneInbox(SCOPE, 'phone_1')

    expect(result).toBeNull()
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'phone_1', organizationId: { in: ['org_1', 'org_2'] }, status: LIVE },
    })
  })
})

describe('countLivePhoneInboxes', () => {
  beforeEach(() => vi.resetAllMocks())

  it('counts pending and active numbers for one organization, not released or failed', async () => {
    countMock.mockResolvedValue(3)
    const { countLivePhoneInboxes } = await import('../phone-inbox')

    expect(await countLivePhoneInboxes('org_1')).toBe(3)
    expect(countMock).toHaveBeenCalledWith({ where: { organizationId: 'org_1', status: LIVE } })
  })
})
