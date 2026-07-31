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
  isStarred: boolean
  tags: string[]
  extractedOtp: string | null
  createdAt: Date
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
    isStarred: message.isStarred,
    tags: message.tags,
    // Included on purpose — see the field allowlist note above. Derived from
    // the body, which this scope already returns.
    extractedOtp: message.extractedOtp,
    createdAt: message.createdAt.toISOString(),
  }
}
