/**
 * Phone Inbox API module
 * Handles all phone inbox-related API calls
 * Targets the dashboard tree at /api/app/phoneInbox.
 */

import { apiClient } from '../api-client'

export interface InboxPhone {
  id: string
  organizationId: string
  userId: string
  phoneNumber: string
  countryCode: string
  createdAt: string
  updatedAt: string
}

export interface CreateInboxPhoneRequest {
  organizationId: string
  phoneNumber: string
  countryCode: string
}

export interface UpdateInboxPhoneRequest {
  phoneNumber?: string
  countryCode?: string
}

/**
 * Get all inbox phone numbers
 * GET /app/phoneInbox
 */
export async function getPhoneInboxes(params?: {
  organizationId?: string
}): Promise<InboxPhone[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<InboxPhone[]>(`/app/phoneInbox${query ? `?${query}` : ''}`)
}

/**
 * Get a single inbox phone number by ID
 * GET /app/phoneInbox/{id}
 */
export async function getPhoneInbox(id: string): Promise<InboxPhone> {
  return apiClient.get<InboxPhone>(`/app/phoneInbox/${id}`)
}

/**
 * Create a new inbox phone number
 * POST /app/phoneInbox
 */
export async function createPhoneInbox(data: CreateInboxPhoneRequest): Promise<InboxPhone> {
  return apiClient.post<InboxPhone>('/app/phoneInbox', data)
}

/**
 * Update an inbox phone number
 * PATCH /app/phoneInbox/{id}
 */
export async function updatePhoneInbox(
  id: string,
  data: UpdateInboxPhoneRequest
): Promise<InboxPhone> {
  return apiClient.patch<InboxPhone>(`/app/phoneInbox/${id}`, data)
}

/**
 * Delete an inbox phone number
 * DELETE /app/phoneInbox/{id}
 */
export async function deletePhoneInbox(id: string): Promise<void> {
  return apiClient.delete<void>(`/app/phoneInbox/${id}`)
}
