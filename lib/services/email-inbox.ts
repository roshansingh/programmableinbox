import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'
import { encodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { fetchGroupedThreadHeads, type GroupedThreadHead } from './grouped-query'
import type { OrgScope, OwnerScope } from './scope'

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

/**
 * Mutations are creator-scoped, not organization-scoped (2026-07-30 split spec
 * §7.1). Reads widened to the organization; mutation authority deliberately did
 * not. Organization-wide delete would let any member destroy any inbox, which
 * cascades to its messages and permanently retires the address — soft-deleted
 * rows keep their `email` so it can never be reclaimed.
 *
 * Every function here resolves ownership through a single `userId`-constrained
 * lookup, so there is no path that mutates a row it did not first prove is owned.
 */
async function ownedInbox(owner: OwnerScope, id: string) {
  return prisma.emailInbox.findFirst({ where: { id, userId: owner.userId } })
}

/**
 * Owner-scoped read, for handlers that must establish mutation authority
 * *before* they inspect the request body.
 *
 * PATCH needs the stored row to compare the submitted address against, and
 * resolving that row through the read scope would answer body-shaped questions
 * for a caller who is not allowed to mutate at all — a non-owner in the same
 * organization would get 409 "address is immutable" instead of 404, which
 * distinguishes an inbox they may not touch from one that does not exist.
 */
export async function getOwnedInbox(owner: OwnerScope, id: string) {
  return ownedInbox(owner, id)
}

export async function updateInbox(
  owner: OwnerScope,
  id: string,
  data: { name?: string | null },
) {
  const inbox = await ownedInbox(owner, id)
  if (!inbox) return null

  return prisma.emailInbox.update({
    where: { id },
    data: { ...(data.name !== undefined && { name: data.name }) },
  })
}

export async function deleteInbox(owner: OwnerScope, id: string): Promise<boolean> {
  const inbox = await ownedInbox(owner, id)
  if (!inbox) return false

  // The inbox and its messages are stamped in the same transaction so neither
  // can be served while the other is hidden. The row is kept rather than
  // removed so its address stays claimed by the unique index (F1).
  const deletedAt = new Date()
  await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { inboxEmailAddressId: id, deletedAt: null },
      data: { deletedAt },
    }),
    prisma.emailInbox.update({ where: { id }, data: { deletedAt } }),
  ])

  return true
}

export async function setMessageStarred(
  owner: OwnerScope,
  inboxId: string,
  messageId: string,
  isStarred: boolean,
) {
  const inbox = await ownedInbox(owner, inboxId)
  if (!inbox) return null

  const message = await prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
  if (!message) return null

  return prisma.emailMessage.update({ where: { id: messageId }, data: { isStarred } })
}

export async function deleteMessage(
  owner: OwnerScope,
  inboxId: string,
  messageId: string,
): Promise<boolean> {
  const inbox = await ownedInbox(owner, inboxId)
  if (!inbox) return false

  const message = await prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
  if (!message) return false

  await prisma.emailMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  })

  return true
}
