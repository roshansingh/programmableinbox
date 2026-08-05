import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageSearch } from '@/lib/search/message-search-params'

const queryRawMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRawMock(...args) },
}))

async function load() {
  return await import('../message-search')
}

const NO_FILTERS: MessageSearch = { q: null, from: null, tags: [], categories: [] }

function search(overrides: Partial<MessageSearch> = {}): MessageSearch {
  return { ...NO_FILTERS, ...overrides }
}

/** SQL text of the last $queryRaw call, with interpolated fragments expanded. */
function rawSql(): string {
  const call = queryRawMock.mock.calls.at(-1) as unknown[]
  const strings = call[0] as string[]
  const values = call.slice(1)
  return strings
    .map((part, i) => {
      if (i >= values.length) return part
      const value = values[i] as { strings?: string[] }
      return part + (Array.isArray(value?.strings) ? value.strings.join(' ? ') : ' ? ')
    })
    .join('')
}

/** Every bound value of the last call, including those inside nested fragments. */
function boundValues(): unknown[] {
  const call = queryRawMock.mock.calls.at(-1) as unknown[]
  return call.slice(1).flatMap((value) => {
    const fragment = value as { values?: unknown[]; strings?: string[] }
    return Array.isArray(fragment?.strings) ? (fragment.values ?? []) : [value]
  })
}

describe('fetchSearchedMessages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    queryRawMock.mockResolvedValue([])
  })

  async function run(s: MessageSearch, opts: Record<string, unknown> = {}) {
    const { fetchSearchedMessages } = await load()
    return fetchSearchedMessages('inbox_1', s, { cursor: null, take: 51, ...opts })
  }

  it('returns the rows the raw query produced', async () => {
    const rows = [{ id: 'm1' }]
    queryRawMock.mockResolvedValue(rows)

    expect(await run(search({ q: 'invoice' }))).toBe(rows)
  })

  describe('scoping', () => {
    it('scopes to the inbox', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).toContain('"inboxEmailAddressId" =')
      expect(boundValues()).toContain('inbox_1')
    })

    /**
     * Raw SQL bypasses the soft-delete client extension in lib/db.ts, so this
     * filter has to be written by hand — the same trap grouped-query.ts documents.
     * Without it, search is a read path that serves deleted mail.
     */
    it('excludes soft-deleted messages', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).toContain('"deletedAt" IS NULL')
    })

    /**
     * Matching against `searchVector` in the WHERE clause is the whole point;
     * *projecting* it is the bug — it is a ~220KB column per row that no
     * serializer reads. So this asserts on the select list specifically.
     */
    it('does not project the search vector', async () => {
      await run(search({ q: 'invoice' }))

      const selectList = rawSql().slice(
        rawSql().indexOf('SELECT'),
        rawSql().indexOf('FROM email_messages'),
      )
      expect(selectList).not.toContain('searchVector')
      expect(selectList).not.toMatch(/SELECT\s+\*/)
      expect(selectList).toContain('"bodyText"')
    })
  })

  describe('full-text query', () => {
    it('matches the query against the search vector', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).toContain('websearch_to_tsquery')
      expect(rawSql()).toContain('"searchVector" @@')
      expect(boundValues()).toContain('invoice')
    })

    it('binds the query rather than interpolating it', async () => {
      await run(search({ q: "'; DROP TABLE email_messages; --" }))

      expect(rawSql()).not.toContain('DROP TABLE')
      expect(boundValues()).toContain("'; DROP TABLE email_messages; --")
    })

    it('omits the full-text clause when no query was given', async () => {
      await run(search({ tags: ['urgent'] }))

      expect(rawSql()).not.toContain('websearch_to_tsquery')
    })
  })

  describe('from', () => {
    it('matches case-insensitively as a substring', async () => {
      await run(search({ from: 'billing@acme.com' }))

      expect(rawSql()).toContain('ILIKE')
      expect(boundValues()).toContain('%billing@acme.com%')
    })

    /**
     * `from` is caller-supplied and lands in a LIKE pattern, where `%` and `_` are
     * wildcards. Unescaped, `from=%` matches every row — a filter that silently
     * does nothing — and a pattern of many `%` is cheap to send and expensive to
     * evaluate.
     */
    it('escapes LIKE wildcards in the caller value', async () => {
      await run(search({ from: '50%_off' }))

      expect(boundValues()).toContain('%50\\%\\_off%')
    })

    it('escapes backslashes so the escape character itself cannot be injected', async () => {
      await run(search({ from: 'a\\b' }))

      expect(boundValues()).toContain('%a\\\\b%')
    })

    it('omits the clause when no from was given', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).not.toContain('ILIKE')
    })
  })

  describe('tags and categories', () => {
    it('matches any of the given tags', async () => {
      await run(search({ tags: ['urgent', 'billing'] }))

      expect(rawSql()).toContain('"tags" &&')
      expect(boundValues()).toContainEqual(['urgent', 'billing'])
    })

    it('matches any of the given categories', async () => {
      await run(search({ categories: ['receipt'] }))

      expect(rawSql()).toContain('"categories" &&')
      expect(boundValues()).toContainEqual(['receipt'])
    })

    it('omits the clauses when neither was given', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).not.toContain('"tags" &&')
      expect(rawSql()).not.toContain('"categories" &&')
    })
  })

  describe('ordering and pagination', () => {
    it('returns newest first for an inbox-wide search', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).toMatch(/ORDER BY\s+"createdAt"\s+DESC,\s+"id"\s+DESC/)
    })

    /**
     * A thread reads top-to-bottom while an inbox reads newest-first. The cursor
     * comparison must match the ORDER BY or pagination silently skips or repeats
     * rows — the same coupling listMessages documents.
     */
    it('returns oldest first when searching within a thread', async () => {
      await run(search({ q: 'invoice' }), { threadId: 'thread_1' })

      expect(rawSql()).toMatch(/ORDER BY\s+"createdAt"\s+ASC,\s+"id"\s+ASC/)
      expect(rawSql()).toContain('"threadId" =')
      expect(boundValues()).toContain('thread_1')
    })

    it('compares the cursor in the descending direction by default', async () => {
      await run(search({ q: 'invoice' }), {
        cursor: { createdAt: new Date(1700000000000), epochMs: 1700000000000, id: 'm9' },
      })

      expect(rawSql()).toContain('extract(epoch')
      expect(rawSql()).toContain('<')
      expect(boundValues()).toContain(1700000000000)
      expect(boundValues()).toContain('m9')
    })

    it('flips the cursor comparison inside a thread', async () => {
      await run(search({ q: 'invoice' }), {
        threadId: 'thread_1',
        cursor: { createdAt: new Date(1700000000000), epochMs: 1700000000000, id: 'm9' },
      })

      expect(rawSql()).toMatch(/\)\s*>\s*\(/)
    })

    it('omits the cursor comparison on the first page', async () => {
      await run(search({ q: 'invoice' }))

      expect(rawSql()).not.toContain('extract(epoch')
    })

    it('applies the row limit', async () => {
      await run(search({ q: 'invoice' }), { take: 51 })

      expect(rawSql()).toContain('LIMIT')
      expect(boundValues()).toContain(51)
    })
  })

  it('combines every filter kind in one query', async () => {
    await run(
      search({ q: 'invoice', from: 'acme', tags: ['urgent'], categories: ['receipt'] }),
    )

    const sql = rawSql()
    expect(sql).toContain('websearch_to_tsquery')
    expect(sql).toContain('ILIKE')
    expect(sql).toContain('"tags" &&')
    expect(sql).toContain('"categories" &&')
  })
})
