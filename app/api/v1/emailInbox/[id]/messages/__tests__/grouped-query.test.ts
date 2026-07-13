import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRawMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRawMock(...args) },
}))

async function load() {
  return await import('../grouped-query')
}

describe('fetchGroupedThreadHeads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns the rows produced by the raw query', async () => {
    const rows = [{ id: 'm1', threadId: 't1', createdAt: new Date(), threadCount: 3 }]
    queryRawMock.mockResolvedValue(rows)
    const { fetchGroupedThreadHeads } = await load()
    const result = await fetchGroupedThreadHeads('inbox_1', null, 51)
    expect(result).toBe(rows)
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })

  it('runs a single query whether or not a cursor is provided', async () => {
    queryRawMock.mockResolvedValue([])
    const { fetchGroupedThreadHeads } = await load()
    await fetchGroupedThreadHeads('inbox_1', { createdAt: new Date(), epochMs: 1, id: 'm1' }, 51)
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })
})
