import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { listMessages } from '@/lib/services/email-inbox'
import { serializePublicMessage } from '@/lib/serializers/public/email-inbox'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const GET = withApiKey<{ id: string }>(
  { scopes: ['messages:read'] },
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

    const result = await listMessages(scope, id, {
      limit: clampLimit(searchParams.get('limit')),
      cursor,
      threadId: searchParams.get('threadId'),
      grouped: searchParams.get('grouped') === 'true',
    })

    if (!result) return jsonError('Not found', 404)

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
