import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import type { DecodedCursor } from '@/lib/pagination/cursor'

/**
 * A thread "head" — the latest message in a thread, plus a count of all
 * messages in that thread. Carries every EmailMessage column (SELECT *) so the
 * route can return it with the same shape as a normal message row.
 */
export interface GroupedThreadHead {
  id: string
  threadId: string
  createdAt: Date
  threadCount: number
  [key: string]: unknown
}

/**
 * Returns the latest message per thread for an inbox, newest thread first,
 * keyset-paginated by (createdAt, id).
 *
 * Raw SQL because Prisma cannot express DISTINCT ON. The window count runs over
 * the full partition BEFORE DISTINCT ON collapses each thread to one row, so
 * threadCount is the total messages in the thread. Cursor comparison uses epoch
 * milliseconds (::bigint) to stay timezone-independent against the
 * `timestamp(3)` column.
 */
export async function fetchGroupedThreadHeads(
  inboxId: string,
  cursor: DecodedCursor | null,
  take: number,
): Promise<GroupedThreadHead[]> {
  const cursorFilter = cursor
    ? Prisma.sql`WHERE ((extract(epoch from "createdAt") * 1000)::bigint, "id") < (${cursor.epochMs}::bigint, ${cursor.id})`
    : Prisma.empty

  return prisma.$queryRaw<GroupedThreadHead[]>`
    WITH heads AS (
      SELECT DISTINCT ON ("threadId") *,
             count(*) OVER (PARTITION BY "threadId")::int AS "threadCount"
      FROM email_messages
      WHERE "inboxEmailAddressId" = ${inboxId}
      ORDER BY "threadId", "createdAt" DESC, "id" DESC
    )
    SELECT * FROM heads
    ${cursorFilter}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${take}
  `
}
