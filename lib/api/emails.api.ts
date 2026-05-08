/**
 * Email Inbox API module
 * Handles all email inbox-related API calls
 * Based on OpenAPI spec: /v1/emailInbox
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
  email?: string
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
  createdAt: string
}

export interface EmailMessagesResponse {
  messages: EmailMessage[]
  total: number
  page: number
  limit: number
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
 * GET /v1/emailInbox
 */
export async function getEmailInboxes(params?: {
  organizationId?: string
}): Promise<InboxEmail[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<InboxEmail[]>(`/v1/emailInbox${query ? `?${query}` : ''}`)
}

/**
 * Get a single inbox email address by ID
 * GET /v1/emailInbox/{id}
 */
export async function getEmailInbox(id: string): Promise<InboxEmail> {
  return apiClient.get<InboxEmail>(`/v1/emailInbox/${id}`)
}

/**
 * Create a new inbox email address
 * POST /v1/emailInbox
 */
export async function createEmailInbox(data: CreateInboxEmailRequest): Promise<InboxEmail> {
  return apiClient.post<InboxEmail>('/v1/emailInbox', data)
}

/**
 * Update an inbox email address
 * PATCH /v1/emailInbox/{id}
 */
export async function updateEmailInbox(
  id: string,
  data: UpdateInboxEmailRequest
): Promise<InboxEmail> {
  return apiClient.patch<InboxEmail>(`/v1/emailInbox/${id}`, data)
}

/**
 * Delete an inbox email address
 * DELETE /v1/emailInbox/{id}
 */
export async function deleteEmailInbox(id: string): Promise<void> {
  return apiClient.delete<void>(`/v1/emailInbox/${id}`)
}

/**
 * Get email messages for an inbox
 * GET /v1/emailInbox/{id}/messages
 */
export async function getEmailMessages(
  inboxId: string,
  params?: { page?: number; limit?: number; threadId?: string; grouped?: boolean }
): Promise<EmailMessagesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.threadId) queryParams.append('threadId', params.threadId)
  if (params?.grouped) queryParams.append('grouped', 'true')
  const query = queryParams.toString()
  return apiClient.get<EmailMessagesResponse>(
    `/v1/emailInbox/${inboxId}/messages${query ? `?${query}` : ''}`
  )
}

/**
 * Send an email from an inbox
 * POST /v1/emailInbox/{id}/send
 */
export async function sendEmail(
  inboxId: string,
  data: SendEmailRequest
): Promise<{ messageId: string }> {
  return apiClient.post<{ messageId: string }>(`/v1/emailInbox/${inboxId}/send`, data)
}
