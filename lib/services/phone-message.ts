import 'server-only'
import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { encodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { getPhoneInbox } from './phone-inbox'
import type { MessageReadScope, OrgScope } from './scope'

/**
 * Reads and read-state for `PhoneMessage` (issue #143).
 *
 * `PhoneMessage` is not in `SOFT_DELETE_MODELS`, so the soft-delete client
 * extension does not filter it: every query here writes `deletedAt` by hand, the
 * raw one included. Dropping it from one of them would serve a deleted message.
 *
 * Every function resolves the inbox through the caller's scope first, so an inbox
 * outside it is indistinguishable from one that does not exist. The inbox must
 * also be live (`pending`/`active`): a released number's messages are not browsable.
 */

export type PhoneMessageRow = {
  id: string
  phoneInboxId: string
  from: string
  to: string
  body: string
  mediaCount: number
  threadId: string
  extractedOtp: string | null
  isRead: boolean
  createdAt: Date
}

/** The latest message of a thread, plus how many live messages and unread ones it holds. */
export type PhoneThreadHead = PhoneMessageRow & { threadCount: number; unreadCount: number }

type Page<T> = { rows: T[]; nextCursor: string | null; hasMore: boolean }

function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  return { rows: kept, hasMore, nextCursor: hasMore ? encodeCursor(kept[kept.length - 1]) : null }
}

/**
 * One row per counterparty, newest thread first, keyset-paginated by
 * (createdAt, id). Raw SQL because Prisma cannot express `DISTINCT ON`. Both
 * counts are window functions over the whole partition, evaluated before
 * `DISTINCT ON` collapses it, so they cover every live message in the thread.
 * Cursor comparison is in epoch milliseconds to stay timezone-independent, and
 * the `::uuid` casts are required because bound params arrive as text.
 */
export async function listPhoneThreads(
  scope: OrgScope,
  inboxId: string,
  opts: { limit: number; cursor: DecodedCursor | null },
): Promise<Page<PhoneThreadHead> | null> {
  if (!(await getPhoneInbox(scope, inboxId))) return null

  const cursorFilter = opts.cursor
    ? Prisma.sql`WHERE ((extract(epoch from "createdAt") * 1000)::bigint, "id") < (${opts.cursor.epochMs}::bigint, ${opts.cursor.id}::uuid)`
    : Prisma.empty

  const rows = await prisma.$queryRaw<PhoneThreadHead[]>`
    WITH heads AS (
      SELECT DISTINCT ON ("threadId")
             "id", "phoneInboxId", "from", "to", "body", "mediaCount", "threadId",
             "extractedOtp", "isRead", "createdAt",
             (count(*) OVER (PARTITION BY "threadId"))::int AS "threadCount",
             (count(*) FILTER (WHERE NOT "isRead") OVER (PARTITION BY "threadId"))::int AS "unreadCount"
      FROM phone_messages
      WHERE "phoneInboxId" = ${inboxId}::uuid
        AND "deletedAt" IS NULL
      ORDER BY "threadId", "createdAt" DESC, "id" DESC
    )
    SELECT * FROM heads
    ${cursorFilter}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${opts.limit + 1}
  `
  return page(rows, opts.limit)
}

const MESSAGE_SELECT = {
  id: true,
  phoneInboxId: true,
  from: true,
  to: true,
  body: true,
  mediaCount: true,
  threadId: true,
  extractedOtp: true,
  isRead: true,
  createdAt: true,
} as const

/**
 * One thread's messages, oldest first: a thread reads top to bottom. The cursor
 * comparison has to match that direction or pagination skips or repeats rows.
 * `phoneInboxId` is bound as well as `threadId`, so a thread id belonging to
 * another inbox returns nothing even though it is only a string.
 */
export async function listThreadMessages(
  scope: OrgScope,
  inboxId: string,
  threadId: string,
  opts: { limit: number; cursor: DecodedCursor | null },
): Promise<Page<PhoneMessageRow> | null> {
  if (!(await getPhoneInbox(scope, inboxId))) return null

  const where: Prisma.PhoneMessageWhereInput = { phoneInboxId: inboxId, threadId, deletedAt: null }
  if (opts.cursor) {
    where.OR = [
      { createdAt: { gt: opts.cursor.createdAt } },
      { createdAt: opts.cursor.createdAt, id: { gt: opts.cursor.id } },
    ]
  }

  const rows = await prisma.phoneMessage.findMany({
    where,
    select: MESSAGE_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: opts.limit + 1,
  })
  return page(rows, opts.limit)
}

/**
 * Sets read state for every live message in one thread. Organization-wide, like
 * email (issue #138): any member who can see the inbox may do it, which is why
 * it takes `MessageReadScope` rather than the creator-only `OwnerScope`.
 * Returns how many rows changed, or `null` for an inbox outside the scope.
 */
export async function markThreadRead(
  scope: MessageReadScope,
  inboxId: string,
  threadId: string,
  isRead: boolean,
): Promise<{ updated: number } | null> {
  if (!(await getPhoneInbox(scope, inboxId))) return null

  const { count } = await prisma.phoneMessage.updateMany({
    where: { phoneInboxId: inboxId, threadId, deletedAt: null, isRead: !isRead },
    data: { isRead },
  })
  return { updated: count }
}
