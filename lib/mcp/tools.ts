import 'server-only'
import { fromJsonSchema } from '@modelcontextprotocol/server'
import type { McpServer } from '@modelcontextprotocol/server'
import { resolveScope } from '@/lib/api-key-scopes'
import {
  toInboxWriteScope,
  toOrgScope,
  type InboxWriteScope,
  type OrgScope,
} from '@/lib/services/scope'
import {
  createInbox,
  getMessage,
  listInboxes,
  listMessages,
  updateInboxForWrite,
} from '@/lib/services/email-inbox'
import { decodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { clampLimit } from '@/lib/pagination/params'
import {
  parseMessageSearch,
  SearchParamError,
  MAX_FILTER_VALUES,
  MAX_QUERY_LENGTH,
  type MessageSearch,
} from '@/lib/search/message-search-params'
import {
  serializeMcpInbox,
  serializeMcpMessageConcise,
  serializeMcpMessageDetailed,
} from '@/lib/serializers/mcp/email-inbox'
import { toolError, toolResult, type ToolResult } from './tool-result'
import type { ApiKeyPrincipal } from '@/lib/auth/principals'

/**
 * The MCP tool surface over the read-only email API (issue #104).
 *
 * Handlers call the service layer **in process** — `toOrgScope(principal)` then
 * `listMessages(scope, ...)`, exactly as `app/api/v1/emailInbox/[id]/messages`
 * does. They deliberately do not call our own REST API over HTTP: forwarding
 * the caller's `sk_live_` key to `/api/v1` is the token-passthrough pattern the
 * MCP security spec forbids outright, and "both ends are ours" is not an
 * exemption to it.
 *
 * This surface is no longer read-only: `email_inboxes:create` and
 * `email_inboxes:update` add `pibx_email_create_inbox` and
 * `pibx_email_update_inbox`. The guarantee that replaced the old blanket one is
 * narrower and still enforced by the compiler rather than by policy —
 * **nothing here can delete anything.**
 *
 * That is now a deliberate asymmetry with `/api/v1`, which *does* expose
 * `DELETE /api/v1/emailInbox/[id]` on `email_inboxes:delete`. The reasoning is
 * the difference in who drives the call. A REST client deletes because someone
 * wrote code to; a tool call can be chosen by a model reading an
 * attacker-controlled message body. Every other operation on this surface can
 * be undone by making another call. Deleting an inbox cannot be undone at all:
 * the row soft-deletes, but `EmailInbox.email` is a plain unique index, so the
 * address is retired for good.
 *
 * The mechanism, not just the intent: the write tools resolve an
 * `InboxWriteScope`, `deleteInbox` takes an `InboxDeleteScope`, and there is no
 * `toInboxDeleteScope` call anywhere in this module. `deleteMessage` and
 * `setMessageStarred` remain on `OwnerScope`, which only a `UserPrincipal` can
 * produce and no principal here ever is.
 *
 * The two write tools change the threat model. An agent reading
 * attacker-controlled message bodies now holds a tool that provisions
 * addresses on domains we own. What stops that being useful to an attacker is
 * not this module — it is `validateInboxAddress` and `validateInboxName`
 * (issue #98), which run inside `createInbox` and cannot be bypassed by any
 * caller. What is *not* covered is volume: an injected instruction to create a
 * thousand inboxes passes every per-request check there is. A per-key creation
 * quota is the open item.
 */

/** Scan depth for `pibx_email_get_latest_otp`. */
const OTP_SCAN_LIMIT = 25

/** Default freshness window for an OTP, in minutes. */
const OTP_DEFAULT_WINDOW_MINUTES = 15

/**
 * Rows reaching a serializer.
 *
 * `listMessages` returns a union with the grouped thread-head shape, which is
 * projected by raw SQL rather than typed by Prisma. Every call here that can
 * produce grouped rows serializes through the concise shape, which reads only
 * fields both members carry.
 */
type SerializableRow = Parameters<typeof serializeMcpMessageConcise>[0]

type ResponseFormat = 'concise' | 'detailed'

function serializeRows(rows: unknown[], format: ResponseFormat) {
  return rows.map((row) =>
    format === 'detailed'
      ? serializeMcpMessageDetailed(row as SerializableRow)
      : serializeMcpMessageConcise(row as SerializableRow),
  )
}

// ---------------------------------------------------------------------------
// Shared JSON Schema fragments
// ---------------------------------------------------------------------------

/**
 * Plain JSON Schema, wrapped by `fromJsonSchema`, rather than Zod.
 *
 * This repo is on `zod@3`; `@modelcontextprotocol/server` installs `zod@4`
 * nested. Schemas built from one instance are not reliably readable by the
 * other, and the SDK only ever needs two things from a schema — a JSON Schema
 * to advertise in `tools/list` and a validator for incoming arguments.
 * `fromJsonSchema` supplies both from the literal below, so the version
 * question never arises and there is exactly one description of each argument
 * instead of a Zod schema and a hand-written doc that drift.
 *
 * No `anyOf`/`oneOf`/`allOf` at the root of any schema here: the Claude API
 * rejects those, so a tool declared that way is invisible to the main client.
 */
const INBOX_ID = {
  type: 'string',
  description: 'The inbox id, as returned by pibx_email_list_inboxes.',
} as const

const LIMIT = {
  type: 'integer',
  minimum: 1,
  maximum: 100,
  description: 'Rows to return (1-100, default 50).',
} as const

const CURSOR = {
  type: 'string',
  description:
    'Opaque pagination cursor from a previous call\'s nextCursor. Omit for the first page.',
} as const

const RESPONSE_FORMAT = {
  type: 'string',
  enum: ['concise', 'detailed'],
  description:
    'concise (default) returns a snippet per message; detailed returns the full body and is much larger.',
} as const

// ---------------------------------------------------------------------------
// Argument plumbing
// ---------------------------------------------------------------------------

type CommonListArgs = {
  inboxId: string
  limit?: number
  cursor?: string
  response_format?: ResponseFormat
}

/** Raised for a caller-correctable problem; every tool turns it into a text result. */
class ToolInputError extends Error {}

function decodeCursorArg(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null
  try {
    return decodeCursor(cursor)
  } catch {
    throw new ToolInputError(
      'The cursor is not valid. Use the nextCursor value from the previous call verbatim, or omit it to start from the first page.',
    )
  }
}

function formatOf(args: { response_format?: ResponseFormat }): ResponseFormat {
  return args.response_format === 'detailed' ? 'detailed' : 'concise'
}

/**
 * Builds the search filter through the same parser both HTTP routes use.
 *
 * The typed arguments are rendered back into a query string on purpose. The
 * point of `parseMessageSearch` is that `/api/app` and `/api/v1` cannot drift
 * on what a parameter means (issue #106); a third caller assembling a
 * `MessageSearch` by hand would reintroduce exactly that drift, and would own a
 * second copy of the caps, the whitespace-means-absent rule and the
 * grouped-mode conflict check. The round-trip through `URLSearchParams` costs
 * nothing measurable and keeps one definition of all of it.
 */
function buildSearch(args: {
  q?: string
  from?: string
  tags?: string[]
  categories?: string[]
  threadId?: string
}): MessageSearch {
  const params = new URLSearchParams()
  if (args.q) params.set('q', args.q)
  if (args.from) params.set('from', args.from)
  for (const tag of args.tags ?? []) params.append('tags', tag)
  for (const category of args.categories ?? []) params.append('categories', category)

  let search: MessageSearch | null
  try {
    // grouped is hard-false: this tool has no `grouped` argument, which is the
    // whole reason it is a separate tool from pibx_email_list_messages.
    search = parseMessageSearch(params, { grouped: false, threadId: args.threadId ?? null })
  } catch (error) {
    if (error instanceof SearchParamError) throw new ToolInputError(error.message)
    throw error
  }

  if (search === null) {
    throw new ToolInputError(
      'Provide at least one of q, from, tags or categories. To list messages without filtering, use pibx_email_list_messages.',
    )
  }

  return search
}

/**
 * Resolves the organization scope for a principal that holds `scope`.
 *
 * The scope check is per tool rather than on the route wrapper. The route is
 * wrapped `withApiKey({ scopes: [] })`, which still resolves the key and
 * enforces revocation and expiry, but a single route-level declaration cannot
 * express "this call needs email_inboxes:read and that one needs
 * email_messages:read" when both arrive down the same POST.
 *
 * Stored scopes are resolved through `resolveScope` for the same reason
 * `withApiKey` does it: the rename migration and this deploy are not atomic,
 * and a key whose row has not been rewritten yet must keep working. The alias
 * table is read-only, so no legacy name can reach a write tool this way.
 */
function authorize(principal: ApiKeyPrincipal, requiredScope: string): OrgScope {
  if (!principal.scopes.map(resolveScope).includes(requiredScope)) {
    throw new ToolInputError(
      `This API key does not have the "${requiredScope}" scope. Create a new key with that scope from the dashboard.`,
    )
  }

  const { scope, error } = toOrgScope(principal)
  if (error) {
    throw new ToolInputError('This API key is not authorized for any organization.')
  }

  return scope
}

/**
 * The write counterpart of `authorize`.
 *
 * Separate rather than a flag on `authorize` because it returns a different
 * scope type, which is the whole mechanism keeping deletion out of reach: a
 * handler holding an `InboxWriteScope` cannot call `deleteInbox`, which wants
 * an `InboxDeleteScope`, and the compiler says so. There is deliberately no
 * `authorizeDelete` here.
 */
function authorizeWrite(
  principal: ApiKeyPrincipal,
  requiredScope: 'email_inboxes:create' | 'email_inboxes:update',
): InboxWriteScope {
  // The required scope is a parameter rather than a single write check,
  // because create and update are separate grants: a key provisioning
  // throwaway inboxes has no reason to be able to rename existing ones.
  if (!principal.scopes.map(resolveScope).includes(requiredScope)) {
    throw new ToolInputError(
      `This API key does not have the "${requiredScope}" scope. Create a new key with that scope from the dashboard.`,
    )
  }

  const { scope, error } = toInboxWriteScope(principal)
  if (error) {
    throw new ToolInputError('This API key is not authorized for any organization.')
  }

  return scope
}

/** The message every "inbox not visible" path returns. */
function inboxNotFound(inboxId: string): ToolInputError {
  // Deliberately identical whether the inbox does not exist or belongs to
  // another organization — the same reason getInbox constrains in the query
  // rather than checking after the fact.
  return new ToolInputError(
    `No inbox with id "${inboxId}" is available to this API key. Call pibx_email_list_inboxes to see the inboxes it can read.`,
  )
}

async function run(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof ToolInputError) return toolError(error.message)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * Every tool is annotated `readOnlyHint: true`.
 *
 * The spec's defaults are `destructiveHint: true` and `openWorldHint: true`, so
 * a tool that omits annotations advertises itself to the client as destructive
 * and unbounded. For a surface that is read-only by construction that is not a
 * missed nicety — it is actively wrong, and clients gate confirmation prompts
 * on it.
 */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/**
 * The write tools' annotations.
 *
 * Not `READ_ONLY` with one field flipped: `idempotentHint` differs between
 * create and update, and a client retrying on a timeout uses it to decide
 * whether a second attempt is safe. Calling create twice claims two addresses.
 *
 * `destructiveHint: false` on both is accurate rather than lenient — neither
 * tool removes anything. The destructive operation is inbox deletion, which
 * this surface deliberately does not expose.
 */
const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const

export type ToolDefinition = {
  name: string
  scope: string
  config: Parameters<McpServer['registerTool']>[1]
  run: (args: never, principal: ApiKeyPrincipal) => Promise<ToolResult>
}

const listInboxesTool: ToolDefinition = {
  name: 'pibx_email_list_inboxes',
  scope: 'email_inboxes:read',
  config: {
    title: 'List email inboxes',
    description:
      'Lists the email inboxes this API key can read. Start here: every other email tool takes an inboxId from this list.',
    inputSchema: fromJsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (_args: never, principal) =>
    run(async () => {
      const scope = authorize(principal, 'email_inboxes:read')
      const inboxes = await listInboxes(scope)
      return toolResult({ inboxes: inboxes.map(serializeMcpInbox) })
    }),
}

type ListMessagesArgs = CommonListArgs & { threadId?: string; grouped?: boolean }

const listMessagesTool: ToolDefinition = {
  name: 'pibx_email_list_messages',
  scope: 'email_messages:read',
  config: {
    title: 'List messages in an inbox',
    description:
      'Lists messages in an inbox, newest first. Returns a snippet per message, not the full body — use pibx_email_get_message for that. To find specific messages, prefer pibx_email_search_messages over paging through this.',
    inputSchema: fromJsonSchema<ListMessagesArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        threadId: {
          type: 'string',
          description:
            'Restrict to one thread. Within a thread messages are returned oldest first, so the conversation reads top to bottom.',
        },
        grouped: {
          type: 'boolean',
          description:
            'Collapse to one row per thread (the latest message in each), with threadCount. Ignored when threadId is set.',
        },
        limit: LIMIT,
        cursor: CURSOR,
        response_format: RESPONSE_FORMAT,
      },
      required: ['inboxId'],
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as ListMessagesArgs
      const scope = authorize(principal, 'email_messages:read')

      const result = await listMessages(scope, typed.inboxId, {
        limit: clampLimit(typed.limit),
        cursor: decodeCursorArg(typed.cursor),
        threadId: typed.threadId ?? null,
        grouped: typed.grouped ?? false,
        search: null,
      })

      if (!result) throw inboxNotFound(typed.inboxId)

      return toolResult({
        messages: serializeRows(result.messages, formatOf(typed)),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      })
    }),
}

type SearchMessagesArgs = CommonListArgs & {
  q?: string
  from?: string
  tags?: string[]
  categories?: string[]
  threadId?: string
}

const searchMessagesTool: ToolDefinition = {
  name: 'pibx_email_search_messages',
  scope: 'email_messages:read',
  config: {
    title: 'Search messages in an inbox',
    description: [
      'Searches one inbox and returns matching messages, newest first.',
      'Combine filters freely: multiple parameters AND together, multiple values within tags or categories OR together.',
      'Filtering only — there is no relevance ranking, and results use the same cursor as pibx_email_list_messages.',
      'Notes that change what "no results" means: q matches the subject and body but not the sender (use from for that);',
      'common English stop words match nothing on their own, so a query of only words like "the is" returns nothing;',
      'tags and categories are exact matches, so a near-miss value returns nothing rather than a close result;',
      'and messages that arrived HTML-only before body indexing shipped are findable by subject but not by body.',
    ].join(' '),
    inputSchema: fromJsonSchema<SearchMessagesArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        q: {
          type: 'string',
          maxLength: MAX_QUERY_LENGTH,
          description:
            'Full-text query over the subject and body. Supports "quoted phrases", or, and -negation.',
        },
        from: {
          type: 'string',
          maxLength: MAX_QUERY_LENGTH,
          description:
            'Case-insensitive substring of the From header, e.g. "stripe.com" or a full address.',
        },
        tags: {
          type: 'array',
          items: { type: 'string', maxLength: MAX_QUERY_LENGTH },
          maxItems: MAX_FILTER_VALUES,
          description: 'Exact tag values. A message matching any of them matches.',
        },
        categories: {
          type: 'array',
          items: { type: 'string', maxLength: MAX_QUERY_LENGTH },
          maxItems: MAX_FILTER_VALUES,
          description: 'Exact category values. A message matching any of them matches.',
        },
        threadId: {
          type: 'string',
          description: 'Restrict the search to one thread.',
        },
        limit: LIMIT,
        cursor: CURSOR,
        response_format: RESPONSE_FORMAT,
      },
      required: ['inboxId'],
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as SearchMessagesArgs
      const scope = authorize(principal, 'email_messages:read')
      const search = buildSearch(typed)

      const result = await listMessages(scope, typed.inboxId, {
        limit: clampLimit(typed.limit),
        cursor: decodeCursorArg(typed.cursor),
        threadId: typed.threadId ?? null,
        // Never grouped. `parseMessageSearch` rejects the combination, and this
        // tool does not accept the argument that would produce it.
        grouped: false,
        search,
      })

      if (!result) throw inboxNotFound(typed.inboxId)

      return toolResult({
        messages: serializeRows(result.messages, formatOf(typed)),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      })
    }),
}

type GetMessageArgs = { inboxId: string; messageId: string }

const getMessageTool: ToolDefinition = {
  name: 'pibx_email_get_message',
  scope: 'email_messages:read',
  config: {
    title: 'Read one message',
    description:
      'Returns a single message with its full plain-text body. HTML is never returned; the body is the parsed text.',
    inputSchema: fromJsonSchema<GetMessageArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        messageId: { type: 'string', description: 'The message id.' },
      },
      required: ['inboxId', 'messageId'],
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as GetMessageArgs
      const scope = authorize(principal, 'email_messages:read')

      const message = await getMessage(scope, typed.inboxId, typed.messageId)
      if (!message) {
        throw new ToolInputError(
          `No message with id "${typed.messageId}" was found in inbox "${typed.inboxId}".`,
        )
      }

      return toolResult({ message: serializeMcpMessageDetailed(message) })
    }),
}

type GetThreadArgs = {
  inboxId: string
  threadId: string
  limit?: number
  response_format?: ResponseFormat
}

const getThreadTool: ToolDefinition = {
  name: 'pibx_email_get_thread',
  scope: 'email_messages:read',
  config: {
    title: 'Read a whole thread',
    description:
      'Returns every message in one thread, oldest first, so the conversation reads top to bottom. Replaces listing a thread and then fetching each message.',
    inputSchema: fromJsonSchema<GetThreadArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        threadId: {
          type: 'string',
          description: 'The thread id, from the threadId field of any message in it.',
        },
        limit: LIMIT,
        response_format: RESPONSE_FORMAT,
      },
      required: ['inboxId', 'threadId'],
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as GetThreadArgs
      const scope = authorize(principal, 'email_messages:read')

      const result = await listMessages(scope, typed.inboxId, {
        limit: clampLimit(typed.limit),
        cursor: null,
        threadId: typed.threadId,
        grouped: false,
        search: null,
      })

      if (!result) throw inboxNotFound(typed.inboxId)

      return toolResult({
        messages: serializeRows(result.messages, formatOf(typed)),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      })
    }),
}

type GetLatestOtpArgs = { inboxId: string; from?: string; withinMinutes?: number }

const getLatestOtpTool: ToolDefinition = {
  name: 'pibx_email_get_latest_otp',
  scope: 'email_messages:read',
  config: {
    title: 'Get the latest one-time code',
    description:
      'Returns the most recent one-time passcode extracted from a message in this inbox, with the message it came from. Use this for signup and login codes instead of listing messages and reading bodies.',
    inputSchema: fromJsonSchema<GetLatestOtpArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        from: {
          type: 'string',
          description:
            'Only consider messages whose From header contains this substring, e.g. "stripe.com".',
        },
        withinMinutes: {
          type: 'integer',
          minimum: 1,
          maximum: 1440,
          description:
            'How recent the code must be. Defaults to 15 minutes, because a stale code looks identical to a fresh one and will silently fail wherever it is used.',
        },
      },
      required: ['inboxId'],
      additionalProperties: false,
    }),
    annotations: READ_ONLY,
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as GetLatestOtpArgs
      const scope = authorize(principal, 'email_messages:read')

      const windowMinutes = typed.withinMinutes ?? OTP_DEFAULT_WINDOW_MINUTES
      // A `from` filter goes through the shared parser like any other search,
      // so the sender substring is escaped and capped identically here and on
      // the HTTP routes.
      const search = typed.from ? buildSearch({ from: typed.from }) : null

      const result = await listMessages(scope, typed.inboxId, {
        limit: OTP_SCAN_LIMIT,
        cursor: null,
        threadId: null,
        grouped: false,
        search,
      })

      if (!result) throw inboxNotFound(typed.inboxId)

      const cutoff = Date.now() - windowMinutes * 60_000
      const rows = result.messages as SerializableRow[]
      const match = rows.find(
        (row) => row.extractedOtp !== null && row.createdAt.getTime() >= cutoff,
      )

      if (!match) {
        // Distinguishes "nothing arrived" from "something arrived but is stale",
        // because the fix differs: wait and retry, versus request a new code.
        const stale = rows.some((row) => row.extractedOtp !== null)
        return toolResult({
          otp: null,
          reason: stale
            ? `A one-time code was found but it is older than ${windowMinutes} minutes. Request a new one, or raise withinMinutes if an older code is acceptable.`
            : `No message with a one-time code has arrived in the last ${windowMinutes} minutes. If one is expected, wait and call again.`,
        })
      }

      return toolResult({
        otp: match.extractedOtp,
        message: serializeMcpMessageConcise(match),
      })
    }),
}

type CreateInboxArgs = { email: string; name?: string }

const createInboxTool: ToolDefinition = {
  name: 'pibx_email_create_inbox',
  scope: 'email_inboxes:create',
  config: {
    title: 'Create an email inbox',
    description:
      'Creates a new email inbox and returns it. The address must be on a domain this account can receive at, and cannot be changed afterwards — create another inbox instead. Use this to provision a throwaway address before a signup, then read the code back with pibx_email_get_latest_otp.',
    inputSchema: fromJsonSchema<CreateInboxArgs>({
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description:
            'The full address to claim, e.g. "qa-run-4@yourdomain.com". Normalized to lowercase. Permanent.',
        },
        name: {
          type: 'string',
          description: 'Optional display label for the inbox. Not part of the address.',
        },
      },
      required: ['email'],
      additionalProperties: false,
    }),
    annotations: { ...WRITES, idempotentHint: false },
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as CreateInboxArgs
      const scope = authorizeWrite(principal, 'email_inboxes:create')

      const result = await createInbox(scope, { email: typed.email, name: typed.name })
      // Every rejection here is caller-correctable — a malformed address, a
      // disallowed domain, an impersonating name, an address already taken.
      // Surfacing the service's own wording keeps one description of each rule.
      if (result.error) throw new ToolInputError(result.error.message)

      return toolResult({ inbox: serializeMcpInbox(result.inbox) })
    }),
}

type UpdateInboxArgs = { inboxId: string; name: string }

const updateInboxTool: ToolDefinition = {
  name: 'pibx_email_update_inbox',
  scope: 'email_inboxes:update',
  config: {
    title: 'Rename an email inbox',
    description:
      'Changes an inbox display name. The address itself cannot be changed — create a new inbox for a different address.',
    inputSchema: fromJsonSchema<UpdateInboxArgs>({
      type: 'object',
      properties: {
        inboxId: INBOX_ID,
        name: {
          type: 'string',
          description: 'The new display label. Send an empty string to clear it.',
        },
      },
      required: ['inboxId', 'name'],
      // No `email` property, deliberately. Advertising an argument the service
      // will always reject invites a model to retry it indefinitely.
      additionalProperties: false,
    }),
    annotations: { ...WRITES, idempotentHint: true },
  },
  run: async (args: never, principal) =>
    run(async () => {
      const typed = args as UpdateInboxArgs
      const scope = authorizeWrite(principal, 'email_inboxes:update')

      const result = await updateInboxForWrite(scope, typed.inboxId, { name: typed.name })
      if (result.error) {
        // A 404 here means the same thing it means on a read: the inbox does
        // not exist, or it is not this key's to touch. Same wording, so the
        // difference is not observable.
        if (result.error.status === 404) throw inboxNotFound(typed.inboxId)
        throw new ToolInputError(result.error.message)
      }

      return toolResult({ inbox: serializeMcpInbox(result.inbox) })
    }),
}

export const EMAIL_TOOLS: readonly ToolDefinition[] = [
  listInboxesTool,
  listMessagesTool,
  searchMessagesTool,
  getMessageTool,
  getThreadTool,
  getLatestOtpTool,
  createInboxTool,
  updateInboxTool,
]

/**
 * Registers every tool against a server bound to one API key.
 *
 * The principal is closed over per registration rather than read from a
 * module-level or request-scoped global: the server object is built per
 * request, so a key can only ever reach the data its own scope allows, with no
 * shared state between concurrent requests to get that wrong.
 */
export function registerEmailTools(server: McpServer, principal: ApiKeyPrincipal): void {
  for (const tool of EMAIL_TOOLS) {
    server.registerTool(tool.name, tool.config, ((args: never) =>
      tool.run(args, principal)) as Parameters<McpServer['registerTool']>[2])
  }
}
