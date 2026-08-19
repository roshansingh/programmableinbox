/**
 * The MCP contract (issue #104). A third hand-written allowlist alongside
 * `lib/serializers/public/` and `lib/serializers/app/`, and it exists for a
 * reason none of the others have: the consumer is a model with a token budget.
 *
 * `serializePublicMessage` emits full `text` **and** `html`. Claude Code caps a
 * tool result at 25,000 tokens and warns above 10,000; claude.ai caps at
 * ~150,000 characters. A single templated marketing email clears the warning on
 * its own, and a 50-row page of them is unusable. So the default shape here is a
 * snippet, and the full body is something the caller asks for per message.
 *
 * Two rules that must not be "simplified" away:
 *
 * - **`html` is never emitted, at any verbosity.** Not truncated, not on
 *   request. The plain text is already derived and stored (`bodyText`), and a
 *   truncated HTML document is the worst of both — it spends the budget on
 *   `<style>` rules and delivers no readable prose.
 * - **`searchVector` is never read.** It is not in `MessageRow` below and it is
 *   not in `MESSAGE_COLUMNS`; a tsvector over a 100k-character body is ~220 KB.
 */

/** Characters of body text in a list row. Enough to recognise a message. */
export const SNIPPET_LENGTH = 280

/**
 * Characters of body text in a single-message read.
 *
 * ~20k characters is roughly 5k tokens: comfortably under Claude Code's 10,000
 * token warning threshold for one message, while long enough that a real email
 * — including a quoted reply chain — arrives whole.
 */
export const MAX_DETAIL_BODY_LENGTH = 20_000

type InboxRow = {
  id: string
  email: string
  name: string | null
  createdAt: Date
}

type MessageRow = {
  id: string
  threadId: string
  subject: string
  from: string
  to: string[]
  cc?: string[]
  bodyText: string | null
  text: string
  isStarred: boolean
  isRead: boolean
  tags: string[]
  categories: string[]
  extractedOtp: string | null
  createdAt: Date
  /** Present only on rows from the grouped thread-list query. */
  threadCount?: number
}

/**
 * Truncates on a character budget, marking that it did.
 *
 * The marker is not decoration: without it a model cannot tell a message that
 * ended from one that was cut off, and will answer "the email does not mention
 * X" when X was in the part we dropped.
 */
export function truncate(value: string, limit: number, hint?: string): string {
  if (value.length <= limit) return value
  const dropped = value.length - limit
  return `${value.slice(0, limit)}… [truncated, ${dropped} more characters${hint ? ` — ${hint}` : ''}]`
}

/**
 * The searchable plain text of a message, or the sender's text part.
 *
 * `bodyText` is null only for rows that predate issue #106's backfill and
 * arrived HTML-only; `text` is the raw part and is '' for those. Both empty is a
 * real state, and it is reported as an empty string rather than as null so a
 * caller does not have to distinguish "no body" from "field absent".
 */
function bodyOf(message: MessageRow): string {
  return message.bodyText ?? message.text ?? ''
}

export function serializeMcpInbox(inbox: InboxRow) {
  return {
    id: inbox.id,
    email: inbox.email,
    name: inbox.name,
    createdAt: inbox.createdAt.toISOString(),
  }
}

/**
 * A list row: everything needed to decide which message to open, and nothing
 * that would blow the budget before the model gets to decide.
 *
 * `tags` and `categories` are included because both are filterable by
 * `pibx_email_search_messages`. A caller that can filter on a field but cannot
 * read it back has no way to construct a follow-up query, and no way to learn
 * that the value it guessed is simply not one the corpus uses.
 */
export function serializeMcpMessageConcise(message: MessageRow) {
  const body = bodyOf(message)

  return {
    id: message.id,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    createdAt: message.createdAt.toISOString(),
    isStarred: message.isStarred,
    tags: message.tags,
    categories: message.categories,
    // Surfaced in the list shape on purpose: the whole point of
    // pibx_email_get_latest_otp is that a code is findable in one call, and a
    // model scanning a list should not have to open each message to notice one.
    extractedOtp: message.extractedOtp,
    snippet: truncate(body, SNIPPET_LENGTH, 'call pibx_email_get_message for the full body'),
    /**
     * Whether `snippet` is the whole body. Lets a model decide whether opening
     * the message can tell it anything more, without a second round-trip to
     * find out that it cannot.
     */
    hasMoreBody: body.length > SNIPPET_LENGTH,
    ...(message.threadCount !== undefined && { threadCount: message.threadCount }),
  }
}

/** A single-message read: the concise row plus the body, still bounded. */
export function serializeMcpMessageDetailed(message: MessageRow) {
  const { snippet: _snippet, hasMoreBody: _hasMoreBody, ...concise } = serializeMcpMessageConcise(message)

  return {
    ...concise,
    cc: message.cc ?? [],
    // No "fetch the rest" hint: this *is* the full read, so there is nothing
    // further to call. A body over the cap is genuinely unavailable over MCP.
    body: truncate(bodyOf(message), MAX_DETAIL_BODY_LENGTH),
  }
}
