/**
 * The external API contract. Hand-written allowlists — never a Prisma model
 * spread and never a passthrough `select`, so a column added to the schema
 * cannot publish itself to external consumers.
 *
 * The inline snapshots in the tests are the enforcement: adding or removing a
 * field here fails the build, which turns "we should keep this stable" into a
 * decision someone has to make deliberately.
 */
type InboxRow = {
  id: string
  organizationId: string
  email: string
  name: string | null
  createdAt: Date
  updatedAt: Date
}

type MessageRow = {
  id: string
  threadId: string
  parentMessageId: string | null
  subject: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  text: string
  html: string
  bodyText: string | null
  isStarred: boolean
  tags: string[]
  categories: string[]
  extractedOtp: string | null
  createdAt: Date
  /**
   * Present only on rows from the grouped thread-list query. Part of the
   * published contract — the OpenAPI spec documents it on this endpoint as
   * "present only in grouped mode", and the pre-split route returned the raw
   * grouped rows, so dropping it would silently break existing consumers.
   */
  threadCount?: number
}

export function serializePublicInbox(inbox: InboxRow) {
  return {
    id: inbox.id,
    organizationId: inbox.organizationId,
    email: inbox.email,
    name: inbox.name,
    createdAt: inbox.createdAt.toISOString(),
    updatedAt: inbox.updatedAt.toISOString(),
  }
}

export function serializePublicMessage(message: MessageRow) {
  return {
    id: message.id,
    threadId: message.threadId,
    parentMessageId: message.parentMessageId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    text: message.text,
    html: message.html,
    // The searchable plain text of the body (issue #106). Published because
    // callers filtering on `q` need to see what matched, and it is derived from
    // `text`/`html`, which this scope already returns in full.
    bodyText: message.bodyText,
    isStarred: message.isStarred,
    tags: message.tags,
    // Published alongside the `categories` filter (issue #106). Previously
    // omitted as worker-internal state, but shipping a filter for a field the
    // caller cannot read back is a worse contract than either extreme.
    categories: message.categories,
    // Included on purpose — see the field allowlist note above. Derived from
    // the body, which this scope already returns.
    extractedOtp: message.extractedOtp,
    createdAt: message.createdAt.toISOString(),
    // Omitted rather than sent as undefined when absent, so a flat listing's
    // payload does not carry a key only the grouped view populates.
    ...(message.threadCount !== undefined && { threadCount: message.threadCount }),
  }
}
