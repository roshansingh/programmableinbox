/**
 * Dashboard response shapes. Free to evolve — no external consumer depends on
 * them — but still explicit rather than a model spread.
 *
 * `isOwner` exists because reads are organization-wide while mutations are
 * creator-only: a user now sees inboxes in the list that they cannot rename,
 * delete, or send from. Without this the UI would render actions that always
 * fail. The raw `userId` is not exposed — `isOwner` answers the question the UI
 * actually has without publishing another member's identifier.
 */
type InboxRow = {
  id: string
  organizationId: string
  userId: string
  email: string
  name: string | null
  createdAt: Date
  updatedAt: Date
}

export function serializeAppInbox(inbox: InboxRow, viewerUserId: string) {
  return {
    id: inbox.id,
    organizationId: inbox.organizationId,
    email: inbox.email,
    name: inbox.name,
    isOwner: inbox.userId === viewerUserId,
    createdAt: inbox.createdAt.toISOString(),
    updatedAt: inbox.updatedAt.toISOString(),
  }
}

type MessageRow = {
  id: string
  inboxEmailAddressId: string
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
   * RFC-822 threading headers. Excluded from the public contract as provider
   * internals, but the dashboard needs them: compose-email-dialog.tsx builds a
   * reply's `inReplyTo` and `references` from these two fields, so omitting
   * them silently breaks reply threading in mail clients.
   */
  messageId: string | null
  references: string[]
  /**
   * Enrichment output the dashboard renders (app/emails/[id]/page.tsx shows it
   * as JSON). Excluded from the public contract as worker-internal state, but
   * the UI reads it, so it belongs here.
   */
  metadata: unknown
  /**
   * Present only on rows from the grouped thread-list query, which projects a
   * per-thread count. Optional rather than required because the flat and
   * single-thread views return plain message rows. app/emails/[id]/page.tsx
   * renders the "N messages" badge from it.
   */
  threadCount?: number
}

/**
 * Richer than the public message serializer — the dashboard renders the thread
 * view and needs the inbox id it belongs to. Still explicit rather than a model
 * spread, so a new column is a deliberate addition here rather than an
 * automatic one.
 */
export function serializeAppMessage(message: MessageRow) {
  return {
    id: message.id,
    inboxEmailAddressId: message.inboxEmailAddressId,
    threadId: message.threadId,
    parentMessageId: message.parentMessageId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    text: message.text,
    html: message.html,
    // The searchable plain text of the body (issue #106).
    bodyText: message.bodyText,
    isStarred: message.isStarred,
    tags: message.tags,
    categories: message.categories,
    extractedOtp: message.extractedOtp,
    createdAt: message.createdAt.toISOString(),
    messageId: message.messageId,
    references: message.references,
    metadata: message.metadata ?? null,
    // Omitted entirely rather than sent as undefined when absent, so the flat
    // view's payload does not carry a key the grouped view alone populates.
    ...(message.threadCount !== undefined && { threadCount: message.threadCount }),
  }
}
