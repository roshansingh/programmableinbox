/**
 * Email Inbox API module
 * Handles all email inbox-related API calls
 * Based on OpenAPI spec: /app/emailInbox
 */

import { apiClient } from '../api-client'

export interface InboxEmail {
  id: string
  organizationId: string
  userId: string
  email: string
  name?: string
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

export interface EmailMessage {
  id: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  headers: Record<string, string>
  externalId: string
  inboxEmailAddressId: string
  organizationId: string
  threadId: string
  parentMessageId: string | null
  messageId: string
  inReplyTo: string | null
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
  params?: { cursor?: string; limit?: number; threadId?: string; grouped?: boolean }
): Promise<EmailMessagesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.cursor) queryParams.append('cursor', params.cursor)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.threadId) queryParams.append('threadId', params.threadId)
  if (params?.grouped) queryParams.append('grouped', 'true')
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
