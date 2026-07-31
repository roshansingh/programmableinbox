import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'
import { encodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { fetchGroupedThreadHeads, type GroupedThreadHead } from './grouped-query'
import type { OrgScope } from './scope'

export type ListMessagesOptions = {
  limit: number
  cursor: DecodedCursor | null
  threadId?: string | null
  grouped?: boolean
}

type EmailMessageRow = Awaited<ReturnType<typeof prisma.emailMessage.findMany>>[number]

/**
 * The grouped thread-list view comes from raw SQL and is a different shape from
 * a full message row — it carries threadCount and only the columns the query
 * projects. Both paths land in the same result, so the row type is the union of
 * the two rather than the message row alone. Serializers narrow it per surface.
 */
export type MessageListRow = EmailMessageRow | GroupedThreadHead

export type ListMessagesResult = {
  messages: MessageListRow[]
  nextCursor: string | null
  hasMore: boolean
}

export async function listInboxes(scope: OrgScope, opts: { limit?: number } = {}) {
  return prisma.emailInbox.findMany({
    where: { organizationId: { in: scope.organizationIds } },
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit ?? MAX_UNPAGINATED_ROWS,
  })
}

export async function getInbox(scope: OrgScope, id: string) {
  // The organization constraint is in the query, not a post-hoc check on the
  // result, so there is no code path that loads a row it may not return.
  return prisma.emailInbox.findFirst({
    where: { id, organizationId: { in: scope.organizationIds } },
  })
}

export async function listMessages(
  scope: OrgScope,
  inboxId: string,
  opts: ListMessagesOptions,
): Promise<ListMessagesResult | null> {
  const inbox = await getInbox(scope, inboxId)
  if (!inbox) return null

  const take = opts.limit + 1

  // Grouped thread-list view: one row (latest message) per thread.
  if (opts.grouped && !opts.threadId) {
    const rows = await fetchGroupedThreadHeads(inboxId, opts.cursor, take)
    return page(rows, opts.limit)
  }

  // Flat inbox list (newest first) or single-thread view (oldest first).
  // The direction flip is load-bearing: a thread reads top-to-bottom, an inbox
  // reads newest-first, and the cursor comparison must match the orderBy or
  // pagination silently skips or repeats rows.
  const asc = Boolean(opts.threadId)

  const where: Prisma.EmailMessageWhereInput = { inboxEmailAddressId: inboxId }
  if (opts.threadId) where.threadId = opts.threadId
  if (opts.cursor) {
    where.OR = asc
      ? [
          { createdAt: { gt: opts.cursor.createdAt } },
          { createdAt: opts.cursor.createdAt, id: { gt: opts.cursor.id } },
        ]
      : [
          { createdAt: { lt: opts.cursor.createdAt } },
          { createdAt: opts.cursor.createdAt, id: { lt: opts.cursor.id } },
        ]
  }

  const rows = await prisma.emailMessage.findMany({
    where,
    orderBy: [{ createdAt: asc ? 'asc' : 'desc' }, { id: asc ? 'asc' : 'desc' }],
    take,
  })

  return page(rows, opts.limit)
}

function page(rows: ListMessagesResult['messages'], limit: number): ListMessagesResult {
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  return {
    messages,
    hasMore,
    nextCursor: hasMore ? encodeCursor(messages[messages.length - 1]) : null,
  }
}

export async function getMessage(scope: OrgScope, inboxId: string, messageId: string) {
  const inbox = await getInbox(scope, inboxId)
  if (!inbox) return null

  return prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
}
