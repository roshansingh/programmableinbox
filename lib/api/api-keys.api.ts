/**
 * API Keys API module
 * Handles API key management API calls
 * Based on OpenAPI spec: /v1/apiKeys
 */

import { apiClient } from '../api-client'

export const API_KEY_SCOPES = ['inboxes:read', 'messages:read'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

export interface ApiKeyListItem {
  id: string
  prefix: string
  name: string
  organizationId: string
  userId: string
  scopes: ApiKeyScope[]
  createdAt: string
}

export interface CreatedApiKey extends ApiKeyListItem {
  apiKey: string
}

export interface CreateApiKeyRequest {
  organizationId: string
  name: string
  scopes: ApiKeyScope[]
}

/**
 * Get all API keys
 * GET /v1/apiKeys
 */
export async function getApiKeys(params?: {
  organizationId?: string
}): Promise<ApiKeyListItem[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<ApiKeyListItem[]>(`/v1/apiKeys${query ? `?${query}` : ''}`)
}

/**
 * Get a single API key by ID
 * GET /v1/apiKeys/{id}
 */
export async function getApiKey(id: string): Promise<ApiKeyListItem> {
  return apiClient.get<ApiKeyListItem>(`/v1/apiKeys/${id}`)
}

/**
 * Create a new API key
 * POST /v1/apiKeys
 * Note: The full API key is returned only once on creation
 */
export async function createApiKey(data: CreateApiKeyRequest): Promise<CreatedApiKey> {
  return apiClient.post<CreatedApiKey>('/v1/apiKeys', data)
}

/**
 * Delete an API key
 * DELETE /v1/apiKeys/{id}
 */
export async function deleteApiKey(id: string): Promise<void> {
  return apiClient.delete<void>(`/v1/apiKeys/${id}`)
}
