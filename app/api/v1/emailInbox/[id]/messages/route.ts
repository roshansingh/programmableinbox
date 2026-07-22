import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { Prisma } from '@/lib/generated/prisma/client'
import { encodeCursor, decodeCursor, DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import { fetchGroupedThreadHeads } from './grouped-query'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox) {
    return jsonError('Not found', 404)
  }

  if (context.kind === 'user') {
    if (inbox.userId !== context.userId) {
      return jsonError('Not found', 404)
    }
  } else {
    const scopeResult = requireScope(context, 'messages:read')
    if ('error' in scopeResult) {
      return scopeResult.error
    }

    const orgResult = requireOrgAccess(context, inbox.organizationId)
    if ('error' in orgResult) {
      return orgResult.error
    }
  }

  const searchParams = request.nextUrl.searchParams
  const limit = clampLimit(searchParams.get('limit'))
  const threadId = searchParams.get('threadId')
  const grouped = searchParams.get('grouped') === 'true'
  const cursorParam = searchParams.get('cursor')

  let cursor: DecodedCursor | null = null
  if (cursorParam) {
    try {
      cursor = decodeCursor(cursorParam)
    } catch {
      return jsonError('Invalid cursor', 400)
    }
  }

  const take = limit + 1

  // Grouped thread-list view: one row (latest message) per thread.
  if (grouped && !threadId) {
    const rows = await fetchGroupedThreadHeads(id, cursor, take)
    const hasMore = rows.length > limit
    const messages = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeCursor(messages[messages.length - 1]) : null
    return jsonSuccess({ messages, nextCursor, hasMore })
  }

  // Flat inbox list (newest first) or single-thread view (oldest first).
  const asc = Boolean(threadId)
  const where: Prisma.EmailMessageWhereInput = { inboxEmailAddressId: id }
  if (threadId) where.threadId = threadId
  if (cursor) {
    where.OR = asc
      ? [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ]
      : [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ]
  }

  const rows = await prisma.emailMessage.findMany({
    where,
    orderBy: [{ createdAt: asc ? 'asc' : 'desc' }, { id: asc ? 'asc' : 'desc' }],
    take,
  })
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? encodeCursor(messages[messages.length - 1]) : null
  return jsonSuccess({ messages, nextCursor, hasMore })
}
