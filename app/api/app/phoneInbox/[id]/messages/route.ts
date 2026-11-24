import { withUser } from '@/lib/auth/with-auth'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import logger from '@/lib/logger'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import { serializeAppPhoneMessage, serializeAppPhoneThread } from '@/lib/serializers/app/phone-message'
import { listPhoneThreads, listThreadMessages, markThreadRead } from '@/lib/services/phone-message'
import { toMessageReadScope, toOrgScope } from '@/lib/services/scope'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres stores years 4713 BC to 294276 AD; anything a real message could carry is far inside this. */
const MAX_CURSOR_EPOCH_MS = 253_402_300_799_999 // 9999-12-31

/**
 * `decodeCursor` checks the shape, not whether Postgres can use it: a non-UUID
 * id fails the `::uuid` cast and an instant outside timestamptz's range fails the
 * comparison, both as unhandled exceptions. Refused here as an invalid cursor.
 */
function usable(cursor: DecodedCursor): boolean {
  return UUID.test(cursor.id) && cursor.epochMs >= 0 && cursor.epochMs <= MAX_CURSOR_EPOCH_MS
}

/** Postgres rejects U+0000 in text, which would be a 500 for what is only a bad request. */
function hasNul(value: string): boolean {
  return value.includes('\u0000')
}

/**
 * Without `threadId`: one row per counterparty, newest thread first. With it: that
 * thread's messages, newest first. Same cursor and `limit` as the email routes.
 */
export const GET = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params
  // Not a UUID can match nothing; saying so beats letting Postgres throw on the cast.
  if (!UUID.test(id)) return jsonError('Not found', 404)

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const searchParams = request.nextUrl.searchParams
  const limit = clampLimit(searchParams.get('limit'))
  const threadId = searchParams.get('threadId')
  if (threadId !== null && (threadId.length === 0 || hasNul(threadId))) {
    return jsonError('threadId is invalid', 400)
  }

  let cursor: DecodedCursor | null = null
  const cursorParam = searchParams.get('cursor')
  if (cursorParam) {
    try {
      cursor = decodeCursor(cursorParam)
    } catch {
      return jsonError('Invalid cursor', 400)
    }
    if (!usable(cursor)) return jsonError('Invalid cursor', 400)
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
  if (!UUID.test(id)) return jsonError('Not found', 404)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  const { threadId, isRead } = (body ?? {}) as { threadId?: unknown; isRead?: unknown }
  if (typeof threadId !== 'string' || threadId.length === 0 || hasNul(threadId)) {
    return jsonError('threadId must be a non-empty string without NUL bytes', 400)
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
