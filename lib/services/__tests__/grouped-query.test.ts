import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRawMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRawMock(...args) },
}))

async function load() {
  return await import('../grouped-query')
}

/**
 * The SQL text of the last $queryRaw call.
 *
 * Reads the tagged-template strings array rather than JSON.stringify-ing the
 * whole call: JSON escapes the double quotes around every identifier, so a
 * pattern written against the real SQL silently never matches and the assertion
 * passes for the wrong reason.
 */
function rawSql(): string {
  const call = queryRawMock.mock.calls.at(-1) as unknown[]
  const strings = call[0] as string[]
  const values = call.slice(1)

  // Interleave, expanding interpolated Prisma.Sql fragments (MESSAGE_COLUMNS, the
  // cursor filter) rather than rendering them as "[object Object]" — the SQL those
  // fragments carry is exactly what these assertions are about.
  return strings
    .map((part, i) => {
      if (i >= values.length) return part
      const value = values[i] as { strings?: string[] }
      return part + (Array.isArray(value?.strings) ? value.strings.join(' ? ') : ' ? ')
    })
    .join('')
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

    // Verify the query does NOT contain cursor-based WHERE clause
    const callArgs = queryRawMock.mock.calls[0]
    const stringified = JSON.stringify(callArgs)
    expect(stringified).not.toContain('extract(epoch')
  })

  /**
   * `SELECT *` became a liability once `searchVector` was added (issue #106): a
   * tsvector over a 100k-character body is ~220KB, so a 50-row page would drag
   * ~11MB out of Postgres for a column nothing in the response uses.
   */
  it('does not select the search vector', async () => {
    queryRawMock.mockResolvedValue([])
    const { fetchGroupedThreadHeads } = await load()
    await fetchGroupedThreadHeads('inbox_1', null, 51)

    const sql = rawSql()
    expect(sql).not.toContain('searchVector')
    expect(sql).not.toMatch(/SELECT\s+DISTINCT\s+ON\s+\("threadId"\)\s+\*/)
  })

  it('selects the columns the serializers read', async () => {
    queryRawMock.mockResolvedValue([])
    const { fetchGroupedThreadHeads } = await load()
    await fetchGroupedThreadHeads('inbox_1', null, 51)

    const sql = rawSql()
    for (const column of ['id', 'subject', 'from', 'text', 'html', 'bodyText', 'categories']) {
      expect(sql).toContain(`"${column}"`)
    }
  })

  it('runs a single query whether or not a cursor is provided', async () => {
    queryRawMock.mockResolvedValue([])
    const { fetchGroupedThreadHeads } = await load()
    await fetchGroupedThreadHeads('inbox_1', { createdAt: new Date(), epochMs: 1, id: 'm1' }, 51)
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })

  it('interpolates the cursor values when a cursor is provided', async () => {
    queryRawMock.mockResolvedValue([])
    const { fetchGroupedThreadHeads } = await load()
    const cursorId = 'cur_msg_12345'
    const cursorEpochMs = 1234567890
    await fetchGroupedThreadHeads('inbox_1', { createdAt: new Date(cursorEpochMs), epochMs: cursorEpochMs, id: cursorId }, 51)

    // Verify the cursor values are present in the query
    const callArgs = queryRawMock.mock.calls[0]
    const stringified = JSON.stringify(callArgs)
    expect(stringified).toContain(cursorId)
    expect(stringified).toContain(String(cursorEpochMs))
    // Also verify the WHERE clause with epoch extraction is present
    expect(stringified).toContain('extract(epoch')
  })
})
