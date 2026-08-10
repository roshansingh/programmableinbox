/**
 * Email Inbox API module
 * Handles all email inbox-related API calls
 *
 * Targets the dashboard tree at /api/app/emailInbox. These shapes are NOT the
 * published contract — that is /api/v1, documented in lib/openapi/, and served
 * by lib/serializers/public/. The types below mirror
 * lib/serializers/app/email-inbox.ts and change with it.
 */

import { apiClient } from '../api-client'

/** Mirrors serializeAppInbox. */
export interface InboxEmail {
  id: string
  organizationId: string
  email: string
  name: string | null
  /**
   * Derived server-side from the creator. Reads are organization-wide but
   * mutations are creator-only, so the UI gates rename/delete/send on this —
   * the raw creator id is deliberately not exposed.
   */
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateInboxEmailRequest {
  organizationId: string
  email: string
  name?: string
}

export interface UpdateInboxEmailRequest {
  // `email` is intentionally omitted: an inbox address is immutable once created
  // (see PATCH /app/emailInbox/[id]). To change an address, create a new inbox.
  name?: string
}

/**
 * Mirrors serializeAppMessage. `headers`, `externalId`, `organizationId` and
 * `inReplyTo` are not returned by the app routes — they were on this type
 * before the split, when routes echoed the Prisma row.
 */
export interface EmailMessage {
  id: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  inboxEmailAddressId: string
  threadId: string
  parentMessageId: string | null
  /** RFC-822 Message-ID; compose-email-dialog builds reply headers from it. */
  messageId: string | null
  references: string[]
  tags: string[]
  isStarred: boolean
  categories: string[]
  extractedOtp: string | null
  metadata: {
    links: Array<{ url: string; label?: string; isCta: boolean }>
    timestamps: string[]
  } | null
  createdAt: string
  /** Grouped listings only. */
  threadCount?: number
}

export interface EmailMessagesResponse {
  messages: EmailMessage[]
  nextCursor: string | null
  hasMore: boolean
}

export interface SendEmailRequest {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  inReplyTo?: string
  references?: string
}

/**
 * Get all inbox email addresses
 * GET /app/emailInbox
 */
export async function getEmailInboxes(params?: {
  organizationId?: string
}): Promise<InboxEmail[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<InboxEmail[]>(`/app/emailInbox${query ? `?${query}` : ''}`)
}

/**
 * Get a single inbox email address by ID
 * GET /app/emailInbox/{id}
 */
export async function getEmailInbox(id: string): Promise<InboxEmail> {
  return apiClient.get<InboxEmail>(`/app/emailInbox/${id}`)
}

/**
 * Create a new inbox email address
 * POST /app/emailInbox
 */
export async function createEmailInbox(data: CreateInboxEmailRequest): Promise<InboxEmail> {
  return apiClient.post<InboxEmail>('/app/emailInbox', data)
}

/**
 * Update an inbox email address
 * PATCH /app/emailInbox/{id}
 */
export async function updateEmailInbox(
  id: string,
  data: UpdateInboxEmailRequest
): Promise<InboxEmail> {
  return apiClient.patch<InboxEmail>(`/app/emailInbox/${id}`, data)
}

/**
 * Delete an inbox email address
 * DELETE /app/emailInbox/{id}
 */
export async function deleteEmailInbox(id: string): Promise<void> {
  return apiClient.delete<void>(`/app/emailInbox/${id}`)
}

/**
 * Get email messages for an inbox
 * GET /app/emailInbox/{id}/messages
 */
export async function getEmailMessages(
  inboxId: string,
  params?: { cursor?: string; limit?: number; threadId?: string; grouped?: boolean; q?: string }
): Promise<EmailMessagesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.cursor) queryParams.append('cursor', params.cursor)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.threadId) queryParams.append('threadId', params.threadId)
  if (params?.grouped) queryParams.append('grouped', 'true')
  if (params?.q) queryParams.append('q', params.q)
  const query = queryParams.toString()
  return apiClient.get<EmailMessagesResponse>(
    `/app/emailInbox/${inboxId}/messages${query ? `?${query}` : ''}`
  )
}

/**
 * Send an email from an inbox
 * POST /app/emailInbox/{id}/send
 */
export async function sendEmail(
  inboxId: string,
  data: SendEmailRequest
): Promise<{ messageId: string }> {
  return apiClient.post<{ messageId: string }>(`/app/emailInbox/${inboxId}/send`, data)
}

export async function deleteEmailMessage(inboxId: string, messageId: string): Promise<void> {
  return apiClient.delete<void>(`/app/emailInbox/${inboxId}/messages/${messageId}`)
}

export async function starEmailMessage(
  inboxId: string,
  messageId: string,
  isStarred: boolean
): Promise<EmailMessage> {
  return apiClient.patch<EmailMessage>(`/app/emailInbox/${inboxId}/messages/${messageId}`, {
    isStarred,
  })
}

export interface OtpResult {
  otp: string
  receivedAt: string
  messageId: string
}

/**
 * Get the most recently received OTP for an inbox
 * GET /app/emailInbox/{id}/otp
 */
export async function getLatestOtp(inboxId: string): Promise<OtpResult> {
  return apiClient.get<OtpResult>(`/app/emailInbox/${inboxId}/otp`)
}
