import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { findLatestOtp, OTP_DEFAULT_WINDOW_MINUTES } from '@/lib/services/email-inbox'
import { serializePublicMessage } from '@/lib/serializers/public/email-inbox'
import {
  parseMessageSearch,
  SearchParamError,
  type MessageSearch,
} from '@/lib/search/message-search-params'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

const MIN_WINDOW_MINUTES = 1
const MAX_WINDOW_MINUTES = 1440
const DECIMAL_INTEGER = /^\d+$/

/**
 * Strict on purpose, like decodeCursor/clampLimit: `Number()` coercion alone
 * accepts `"1e2"`, `" 12 "` and `"Infinity"`, all of which are attacker
 * inputs on a query string.
 */
function parseWindowMinutes(raw: string | null): number | { error: string } {
  if (raw === null) return OTP_DEFAULT_WINDOW_MINUTES

  const invalid = {
    error: `withinMinutes must be an integer between ${MIN_WINDOW_MINUTES} and ${MAX_WINDOW_MINUTES}`,
  }
  if (!DECIMAL_INTEGER.test(raw)) return invalid

  const value = Number(raw)
  if (value < MIN_WINDOW_MINUTES || value > MAX_WINDOW_MINUTES) return invalid
  return value
}

// A read of extracted message content, so it takes email_messages:read rather
// than email_inboxes:read — matching the MCP tool's pibx_email_get_latest_otp,
// which shares this lookup through findLatestOtp (lib/services/email-inbox.ts)
// and accepts the same `from`/`withinMinutes` arguments and response shape
// (otp + the message it came from).
export const GET = withApiKey<{ id: string }>(
  { scopes: ['email_messages:read'] },
  async (request, principal, { params }) => {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams

    const { scope, error } = toOrgScope(principal)
    if (error) return error

    const windowMinutes = parseWindowMinutes(searchParams.get('withinMinutes'))
    if (typeof windowMinutes !== 'number') return jsonError(windowMinutes.error, 400)

    // Only ever filters on `from`, mirroring the MCP tool's argument list
    // exactly — unlike GET .../messages, q/tags/categories are not part of
    // this endpoint's contract.
    const fromParam = searchParams.get('from')
    let search: MessageSearch | null = null
    if (fromParam) {
      try {
        search = parseMessageSearch(new URLSearchParams({ from: fromParam }), {
          grouped: false,
          threadId: null,
        })
      } catch (err) {
        if (err instanceof SearchParamError) return jsonError(err.message, 400)
        throw err
      }
    }

    const result = await findLatestOtp(scope, id, { search, windowMinutes })
    if (!result) return jsonError('Not found', 404)

    if (!result.found) {
      // Distinguishes "nothing arrived" from "something arrived but is
      // stale", because the fix differs: wait and retry, versus request a
      // new code.
      return jsonError(
        result.stale
          ? `A one-time code was found but it is older than ${windowMinutes} minutes. Request a new one, or raise withinMinutes if an older code is acceptable.`
          : `No message with a one-time code has arrived in the last ${windowMinutes} minutes.`,
        404,
      )
    }

    return jsonSuccess({
      otp: result.message.extractedOtp as string,
      message: serializePublicMessage(
        result.message as Parameters<typeof serializePublicMessage>[0],
      ),
    })
  },
)
