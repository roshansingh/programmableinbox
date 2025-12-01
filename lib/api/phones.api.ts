/**
 * Phone API module
 * Handles all phone number-related API calls
 */

import { apiClient } from '../api-client'

export interface PhoneNumber {
  id: string
  number: string
  country: string
  countryCode?: string
  createdAt: string
  messageCount: number
  status: 'active' | 'expired'
}

export interface SMSMessage {
  id: string
  from: string
  to: string
  body: string
  receivedAt: string
  direction: 'inbound' | 'outbound'
}

export interface CreatePhoneRequest {
  country?: string
  countryCode?: string
}

export interface PhoneListResponse {
  phones: PhoneNumber[]
  total: number
  page?: number
  limit?: number
}

export interface SMSMessagesResponse {
  messages: SMSMessage[]
  total: number
  page?: number
  limit?: number
}

/**
 * Get list of all phone numbers
 */
export async function getPhones(params?: {
  page?: number
  limit?: number
  status?: 'active' | 'expired'
  country?: string
}): Promise<PhoneListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.status) queryParams.append('status', params.status)
  if (params?.country) queryParams.append('country', params.country)

  const query = queryParams.toString()
  return apiClient.get<PhoneListResponse>(`/phones${query ? `?${query}` : ''}`)
}

/**
 * Get a single phone number by ID
 */
export async function getPhone(id: string): Promise<PhoneNumber> {
  return apiClient.get<PhoneNumber>(`/phones/${id}`)
}

/**
 * Create a new disposable phone number
 */
export async function createPhone(data: CreatePhoneRequest): Promise<PhoneNumber> {
  return apiClient.post<PhoneNumber>('/phones', data)
}

/**
 * Delete a phone number
 */
export async function deletePhone(id: string): Promise<void> {
  return apiClient.delete<void>(`/phones/${id}`)
}

/**
 * Get SMS messages for a specific phone number
 */
export async function getSMSMessages(
  phoneId: string,
  params?: {
    page?: number
    limit?: number
    direction?: 'inbound' | 'outbound'
  }
): Promise<SMSMessagesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.direction) queryParams.append('direction', params.direction)

  const query = queryParams.toString()
  return apiClient.get<SMSMessagesResponse>(
    `/phones/${phoneId}/messages${query ? `?${query}` : ''}`
  )
}

/**
 * Get a single SMS message
 */
export async function getSMSMessage(
  phoneId: string,
  messageId: string
): Promise<SMSMessage> {
  return apiClient.get<SMSMessage>(`/phones/${phoneId}/messages/${messageId}`)
}

/**
 * Delete an SMS message
 */
export async function deleteSMSMessage(
  phoneId: string,
  messageId: string
): Promise<void> {
  return apiClient.delete<void>(`/phones/${phoneId}/messages/${messageId}`)
}

