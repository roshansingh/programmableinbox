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
