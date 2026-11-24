/**
 * Dashboard response shapes for phone messages. Explicit allowlist, not a model
 * spread: `organizationId`, the provider's `externalId` and `deletedAt` are not
 * published, and a column added to the schema does not reach the browser until it
 * is added here.
 */
type PhoneMessageRow = {
  id: string
  phoneInboxId: string
  from: string
  to: string
  body: string
  mediaCount: number
  threadId: string
  extractedOtp: string | null
  isRead: boolean
  createdAt: Date
}

export function serializeAppPhoneMessage(message: PhoneMessageRow) {
  return {
    id: message.id,
    phoneInboxId: message.phoneInboxId,
    from: message.from,
    to: message.to,
    body: message.body,
    mediaCount: message.mediaCount,
    threadId: message.threadId,
    extractedOtp: message.extractedOtp,
    isRead: message.isRead,
    createdAt: message.createdAt.toISOString(),
  }
}

/** A thread's latest message plus its live and unread message counts. */
export function serializeAppPhoneThread(
  head: PhoneMessageRow & { threadCount: number; unreadCount: number },
) {
  return {
    ...serializeAppPhoneMessage(head),
    threadCount: head.threadCount,
    unreadCount: head.unreadCount,
  }
}
