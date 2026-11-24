import { withUser } from '@/lib/auth/with-auth'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import logger from '@/lib/logger'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import { serializeAppPhoneMessage, serializeAppPhoneThread } from '@/lib/serializers/app/phone-message'
import { listPhoneThreads, listThreadMessages, markThreadRead } from '@/lib/services/phone-message'
import { toMessageReadScope, toOrgScope } from '@/lib/services/scope'

/**
 * Without `threadId`: one row per counterparty, newest thread first. With it: that
 * thread's messages, newest first. Same cursor and `limit` as the email routes.
 */
export const GET = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const searchParams = request.nextUrl.searchParams
  const limit = clampLimit(searchParams.get('limit'))
  const threadId = searchParams.get('threadId')

  let cursor: DecodedCursor | null = null
  const cursorParam = searchParams.get('cursor')
  if (cursorParam) {
    try {
      cursor = decodeCursor(cursorParam)
    } catch {
      return jsonError('Invalid cursor', 400)
    }
  }

  if (threadId) {
    const result = await listThreadMessages(scope, id, threadId, { limit, cursor })
    if (!result) return jsonError('Not found', 404)
    return jsonSuccess({
      messages: result.rows.map(serializeAppPhoneMessage),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    })
  }

  const result = await listPhoneThreads(scope, id, { limit, cursor })
  if (!result) return jsonError('Not found', 404)
  return jsonSuccess({
    threads: result.rows.map(serializeAppPhoneThread),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  })
})

/** Marks every message in one thread read (or unread). Body: `{ threadId, isRead }`. */
export const PATCH = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  const { threadId, isRead } = (body ?? {}) as { threadId?: unknown; isRead?: unknown }
  if (typeof threadId !== 'string' || threadId.length === 0) {
    return jsonError('threadId must be a non-empty string', 400)
  }
  if (typeof isRead !== 'boolean') {
    return jsonError('isRead must be a boolean', 400)
  }

  // Organization-wide, like email's isRead (issue #138): any member who can see a
  // shared inbox can progress its read state, not just its creator.
  const { scope, error } = toMessageReadScope(principal)
  if (error) return error

  try {
    const result = await markThreadRead(scope, id, threadId, isRead)
    if (!result) return jsonError('Not found', 404)
    return jsonSuccess(result)
  } catch (error) {
    logger.error({ error, inboxId: id }, 'Failed to update phone thread read state')
    return jsonError('Internal server error', 500)
  }
})
