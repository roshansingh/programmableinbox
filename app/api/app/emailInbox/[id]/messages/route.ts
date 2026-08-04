import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { listMessages } from '@/lib/services/email-inbox'
import { serializeAppMessage } from '@/lib/serializers/app/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import {
  parseMessageSearch,
  SearchParamError,
  type MessageSearch,
} from '@/lib/search/message-search-params'

export const GET = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

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

  // Search parameters are parsed by the same module the v1 route uses, so the two
  // surfaces cannot drift apart on what they accept (issue #106). It takes
  // threadId because grouping is only in effect without one.
  let search: MessageSearch | null
  try {
    search = parseMessageSearch(searchParams, { grouped, threadId })
  } catch (error) {
    if (error instanceof SearchParamError) return jsonError(error.message, 400)
    throw error
  }

  // listMessages resolves the inbox through the same scope, so an inbox outside
  // it is indistinguishable from one that does not exist.
  const result = await listMessages(scope, id, { limit, cursor, threadId, grouped, search })
  if (!result) return jsonError('Not found', 404)

  return jsonSuccess({
    messages: result.messages.map((message) =>
      serializeAppMessage(message as Parameters<typeof serializeAppMessage>[0]),
    ),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  })
})
