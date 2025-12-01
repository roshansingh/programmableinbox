/**
 * Webhooks API module
 * Handles webhook configuration and management API calls
 */

import { apiClient } from '../api-client'

export interface WebhookConfig {
  id: string
  name: string
  url: string
  events: string[]
  createdAt: string
  lastTriggered?: string
  status: 'active' | 'inactive' | 'failing'
  secret?: string
}

export interface CreateWebhookRequest {
  name: string
  url: string
  events: string[]
  secret?: string
}

export interface UpdateWebhookRequest {
  name?: string
  url?: string
  events?: string[]
  status?: 'active' | 'inactive'
  secret?: string
}

export interface WebhookListResponse {
  webhooks: WebhookConfig[]
  total: number
  page?: number
  limit?: number
}

export interface WebhookEvent {
  id: string
  webhookId: string
  event: string
  payload: Record<string, unknown>
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  createdAt: string
  deliveredAt?: string
}

export interface WebhookEventsResponse {
  events: WebhookEvent[]
  total: number
  page?: number
  limit?: number
}

/**
 * Get list of all webhooks
 */
export async function getWebhooks(params?: {
  page?: number
  limit?: number
  status?: 'active' | 'inactive' | 'failing'
}): Promise<WebhookListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.status) queryParams.append('status', params.status)

  const query = queryParams.toString()
  return apiClient.get<WebhookListResponse>(`/webhooks${query ? `?${query}` : ''}`)
}

/**
 * Get a single webhook by ID
 */
export async function getWebhook(id: string): Promise<WebhookConfig> {
  return apiClient.get<WebhookConfig>(`/webhooks/${id}`)
}

/**
 * Create a new webhook
 */
export async function createWebhook(data: CreateWebhookRequest): Promise<WebhookConfig> {
  return apiClient.post<WebhookConfig>('/webhooks', data)
}

/**
 * Update a webhook
 */
export async function updateWebhook(
  id: string,
  data: UpdateWebhookRequest
): Promise<WebhookConfig> {
  return apiClient.patch<WebhookConfig>(`/webhooks/${id}`, data)
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(id: string): Promise<void> {
  return apiClient.delete<void>(`/webhooks/${id}`)
}

/**
 * Test a webhook (trigger a test event)
 */
export async function testWebhook(id: string): Promise<void> {
  return apiClient.post<void>(`/webhooks/${id}/test`)
}

/**
 * Get webhook events/delivery logs
 */
export async function getWebhookEvents(
  webhookId: string,
  params?: {
    page?: number
    limit?: number
    status?: 'pending' | 'delivered' | 'failed'
  }
): Promise<WebhookEventsResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.status) queryParams.append('status', params.status)

  const query = queryParams.toString()
  return apiClient.get<WebhookEventsResponse>(
    `/webhooks/${webhookId}/events${query ? `?${query}` : ''}`
  )
}

/**
 * Retry a failed webhook event
 */
export async function retryWebhookEvent(
  webhookId: string,
  eventId: string
): Promise<void> {
  return apiClient.post<void>(`/webhooks/${webhookId}/events/${eventId}/retry`)
}

