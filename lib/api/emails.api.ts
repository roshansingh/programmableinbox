/**
 * Email API module
 * Handles all email-related API calls
 */

import { apiClient } from '../api-client'

export interface Email {
  id: string
  address: string
  createdAt: string
  messageCount: number
  status: 'active' | 'expired'
  domain?: string
  prefix?: string
}

export interface EmailMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  html?: string
  text?: string
  receivedAt: string
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  url: string
}

export interface CreateEmailRequest {
  prefix?: string
  domain?: string
}

export interface EmailListResponse {
  emails: Email[]
  total: number
  page?: number
  limit?: number
}

export interface EmailMessagesResponse {
  messages: EmailMessage[]
  total: number
  page?: number
  limit?: number
}

/**
 * Get list of all emails
 */
export async function getEmails(params?: {
  page?: number
  limit?: number
  status?: 'active' | 'expired'
}): Promise<EmailListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.status) queryParams.append('status', params.status)

  const query = queryParams.toString()
  return apiClient.get<EmailListResponse>(`/emails${query ? `?${query}` : ''}`)
}

/**
 * Get a single email by ID
 */
export async function getEmail(id: string): Promise<Email> {
  return apiClient.get<Email>(`/emails/${id}`)
}

/**
 * Create a new disposable email
 */
export async function createEmail(data: CreateEmailRequest): Promise<Email> {
  return apiClient.post<Email>('/emails', data)
}

/**
 * Delete an email
 */
export async function deleteEmail(id: string): Promise<void> {
  return apiClient.delete<void>(`/emails/${id}`)
}

/**
 * Get messages for a specific email
 */
export async function getEmailMessages(
  emailId: string,
  params?: {
    page?: number
    limit?: number
  }
): Promise<EmailMessagesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())

  const query = queryParams.toString()
  return apiClient.get<EmailMessagesResponse>(
    `/emails/${emailId}/messages${query ? `?${query}` : ''}`
  )
}

/**
 * Get a single email message
 */
export async function getEmailMessage(
  emailId: string,
  messageId: string
): Promise<EmailMessage> {
  return apiClient.get<EmailMessage>(`/emails/${emailId}/messages/${messageId}`)
}

/**
 * Delete an email message
 */
export async function deleteEmailMessage(
  emailId: string,
  messageId: string
): Promise<void> {
  return apiClient.delete<void>(`/emails/${emailId}/messages/${messageId}`)
}

