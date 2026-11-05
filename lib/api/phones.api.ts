/**
 * Phone Inbox API module
 * Handles all phone inbox-related API calls
 * Targets the dashboard tree at /api/app/phoneInbox.
 */

import { apiClient } from '../api-client'

/** Countries a number can be bought in. Mirrors `SMS_COUNTRIES` on the server. */
export type PhoneCountry = 'US' | 'CA'

export interface InboxPhone {
  id: string
  organizationId: string
  /** E.164, e.g. `+14155550100`. */
  phoneNumber: string
  countryCode: string
  status: 'pending' | 'active' | 'released' | 'failed'
  capabilities: { sms: boolean; mms: boolean; voice: boolean } | null
  /**
   * Reads are organization-wide but releasing a number is creator-only, so a
   * teammate's number is visible with this false. The UI gates on it rather
   * than rendering a delete that would 404.
   */
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

/** A number Twilio is offering for sale. Not yet owned by anyone. */
export interface AvailablePhoneNumber {
  phoneNumber: string
  locality: string | null
  region: string | null
}

export interface CreateInboxPhoneRequest {
  organizationId: string
  /** Must be one returned by {@link searchAvailablePhoneNumbers}. */
  phoneNumber: string
  countryCode: PhoneCountry
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
 * Search the numbers available to buy in an area code
 * GET /app/phoneInbox/available
 */
export async function searchAvailablePhoneNumbers(params: {
  organizationId: string
  country: PhoneCountry
  areaCode: string
}): Promise<AvailablePhoneNumber[]> {
  const query = new URLSearchParams({
    organizationId: params.organizationId,
    country: params.country,
    areaCode: params.areaCode,
  })
  return apiClient.get<AvailablePhoneNumber[]>(`/app/phoneInbox/available?${query.toString()}`)
}

/**
 * Buy a number and create its inbox. Spends real money.
 * POST /app/phoneInbox
 */
export async function createPhoneInbox(data: CreateInboxPhoneRequest): Promise<InboxPhone> {
  return apiClient.post<InboxPhone>('/app/phoneInbox', data)
}

/**
 * Delete an inbox and release its number back to the provider. Not reversible:
 * the number returns to the pool and anyone may buy it.
 * DELETE /app/phoneInbox/{id}
 */
export async function deletePhoneInbox(id: string): Promise<void> {
  return apiClient.delete<void>(`/app/phoneInbox/${id}`)
}
