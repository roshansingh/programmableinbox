/**
 * API Keys API module
 * Handles API key management API calls
 * Based on OpenAPI spec: /v1/apiKeys
 */

import { apiClient } from '../api-client'

export interface ApiKey {
  id: string
  apiKey: string
  name: string
  organizationId: string
  userId: string
  createdAt: string
}

export interface CreateApiKeyRequest {
  organizationId: string
  name: string
}

/**
 * Get all API keys
 * GET /v1/apiKeys
 */
export async function getApiKeys(params?: {
  organizationId?: string
}): Promise<ApiKey[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<ApiKey[]>(`/v1/apiKeys${query ? `?${query}` : ''}`)
}

/**
 * Get a single API key by ID
 * GET /v1/apiKeys/{id}
 */
export async function getApiKey(id: string): Promise<ApiKey> {
  return apiClient.get<ApiKey>(`/v1/apiKeys/${id}`)
}

/**
 * Create a new API key
 * POST /v1/apiKeys
 * Note: The full API key is returned only once on creation
 */
export async function createApiKey(data: CreateApiKeyRequest): Promise<ApiKey> {
  return apiClient.post<ApiKey>('/v1/apiKeys', data)
}

/**
 * Delete an API key
 * DELETE /v1/apiKeys/{id}
 */
export async function deleteApiKey(id: string): Promise<void> {
  return apiClient.delete<void>(`/v1/apiKeys/${id}`)
}
