import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { listMessages } from '@/lib/services/email-inbox'
import { serializePublicMessage } from '@/lib/serializers/public/email-inbox'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import {
  parseMessageSearch,
  SearchParamError,
  hasMessageSearch,
  type MessageSearch,
} from '@/lib/search/message-search-params'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { captureEvent, PRODUCT_ANALYTICS_EVENTS } from '@/ee/product-analytics/capture'

export const GET = withApiKey<{ id: string }>(
  { scopes: ['email_messages:read'] },
  async (request, principal, { params }) => {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams

    const { scope, error } = toOrgScope(principal)
    if (error) return error

    let cursor: DecodedCursor | null = null
    const cursorParam = searchParams.get('cursor')
    if (cursorParam) {
      try {
        cursor = decodeCursor(cursorParam)
      } catch {
        return jsonError('Invalid cursor', 400)
      }
    }

    const grouped = searchParams.get('grouped') === 'true'
    const threadId = searchParams.get('threadId')

    // Same parser as the app route, so the published contract and the dashboard
    // cannot diverge on what a search parameter means (issue #106). It takes
    // threadId because grouping is only in effect without one.
    let search: MessageSearch | null
    try {
      search = parseMessageSearch(searchParams, { grouped, threadId })
    } catch (error) {
      if (error instanceof SearchParamError) return jsonError(error.message, 400)
      throw error
    }

    const result = await listMessages(scope, id, {
      limit: clampLimit(searchParams.get('limit')),
      cursor,
      threadId,
      grouped,
      search,
    })

    if (!result) return jsonError('Not found', 404)

    if (hasMessageSearch(search) && config.productAnalytics.enabled) {
      captureEvent(PRODUCT_ANALYTICS_EVENTS.messageSearchUsed, principal.userId, { inboxId: id })
    }

    // Envelope key names match the pre-split route exactly — the OpenAPI spec
    // and existing consumers depend on messages/nextCursor/hasMore.
    return jsonSuccess({
      messages: result.messages.map((message) =>
        serializePublicMessage(message as Parameters<typeof serializePublicMessage>[0]),
      ),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    })
  },
)
