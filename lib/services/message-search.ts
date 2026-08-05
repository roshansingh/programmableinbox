import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { MESSAGE_COLUMNS } from './message-columns'
import type { DecodedCursor } from '@/lib/pagination/cursor'
import type { MessageSearch } from '@/lib/search/message-search-params'

/**
 * Message search (issue #106).
 *
 * Raw SQL rather than Prisma's query builder, for three reasons that are worth
 * stating because none of them is a preference:
 *
 * 1. Prisma's `search` field operator needs the `fullTextSearchPostgres` preview
 *    feature, and it emits `to_tsquery`, which *raises* on malformed input — a
 *    stray `&` in a user's search box becomes a 500. `websearch_to_tsquery` is
 *    total: it accepts anything a person might type.
 * 2. `searchVector` is a generated column declared `Unsupported` in the schema, so
 *    Prisma cannot reference it at all.
 * 3. Array overlap (`&&`) has no Prisma equivalent that indexes the same way.
 *
 * The cost of raw SQL is that it bypasses the soft-delete client extension in
 * lib/db.ts, so `deletedAt IS NULL` is written by hand below — the same hazard
 * grouped-query.ts carries. That is the one thing in this file that must never be
 * removed as redundant.
 *
 * Every caller-supplied value is a bound parameter. There is no string
 * interpolation of `q`, `from`, `tags` or `categories` anywhere in this module.
 */

export interface SearchMessagesOptions {
  /** Restricts the search to one thread, which also flips the sort direction. */
  threadId?: string | null
  cursor: DecodedCursor | null
  /** Row limit, normally `limit + 1` so the caller can detect a next page. */
  take: number
}

type EmailMessageRow = Awaited<ReturnType<typeof prisma.emailMessage.findMany>>[number]

/**
 * LIKE-escapes a caller value so it matches literally.
 *
 * `%` and `_` are wildcards in a LIKE pattern, so without this `from=%` is a
 * filter that matches everything while looking like it filters, and a value of
 * many `%` is a few bytes to send and a lot of backtracking to evaluate. The
 * backslash is escaped first, otherwise escaping the others would corrupt a value
 * that legitimately contains one.
 *
 * Postgres's default LIKE escape character is the backslash, so no ESCAPE clause
 * is needed. The doubling is applied to the *value*, which travels as a bound
 * parameter — this is not SQL escaping and is not a substitute for it.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * Returns messages in `inboxId` matching every supplied filter, newest first —
 * or oldest first within a thread.
 *
 * Ordering and cursor semantics deliberately match the plain listing path in
 * `listMessages`, so search is an additional WHERE and nothing else: the same
 * `(createdAt, id)` keyset cursor stays valid across a search, and a client can
 * add `?q=` to a request without a second pagination contract. Relevance ranking
 * would need a different cursor and is a separate change.
 */
export async function fetchSearchedMessages(
  inboxId: string,
  search: MessageSearch,
  options: SearchMessagesOptions,
): Promise<EmailMessageRow[]> {
  // A thread reads top-to-bottom, an inbox reads newest-first. The cursor
  // comparison below must match this or pagination silently skips or repeats rows.
  const asc = Boolean(options.threadId)

  const conditions: Prisma.Sql[] = [
    Prisma.sql`"inboxEmailAddressId" = ${inboxId}::uuid`,
    // Load-bearing: raw SQL does not go through the soft-delete extension.
    Prisma.sql`"deletedAt" IS NULL`,
  ]

  if (options.threadId) {
    conditions.push(Prisma.sql`"threadId" = ${options.threadId}::uuid`)
  }

  if (search.q) {
    // websearch_to_tsquery, not to_tsquery: it never raises on user input, and it
    // gives callers "quoted phrases", `or` and `-negation` for free. The regconfig
    // must match the one the generated column was built with, or the stemming on
    // each side disagrees and searches quietly under-match.
    conditions.push(
      Prisma.sql`"searchVector" @@ websearch_to_tsquery('english', ${search.q})`,
    )
  }

  if (search.from) {
    conditions.push(Prisma.sql`"from" ILIKE ${`%${escapeLikePattern(search.from)}%`}`)
  }

  if (search.tags.length > 0) {
    conditions.push(Prisma.sql`"tags" && ${search.tags}::text[]`)
  }

  if (search.categories.length > 0) {
    conditions.push(Prisma.sql`"categories" && ${search.categories}::text[]`)
  }

  if (options.cursor) {
    // Epoch milliseconds via ::bigint, matching grouped-query.ts: it keeps the
    // comparison timezone-independent against the timestamptz column, and the
    // row-value comparison gives a correct (createdAt, id) keyset in one clause.
    const { epochMs, id } = options.cursor
    conditions.push(
      asc
        ? Prisma.sql`((extract(epoch from "createdAt") * 1000)::bigint, "id") > (${epochMs}::bigint, ${id}::uuid)`
        : Prisma.sql`((extract(epoch from "createdAt") * 1000)::bigint, "id") < (${epochMs}::bigint, ${id}::uuid)`,
    )
  }

  const where = Prisma.join(conditions, ' AND ')
  const order = asc
    ? Prisma.sql`ORDER BY "createdAt" ASC, "id" ASC`
    : Prisma.sql`ORDER BY "createdAt" DESC, "id" DESC`

  return prisma.$queryRaw<EmailMessageRow[]>`
    SELECT ${MESSAGE_COLUMNS}
    FROM email_messages
    WHERE ${where}
    ${order}
    LIMIT ${options.take}
  `
}
