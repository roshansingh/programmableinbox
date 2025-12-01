/**
 * API Keys API module
 * Handles API key management API calls
 */

import { apiClient } from '../api-client'

export interface ApiKey {
  id: string
  name: string
  key: string
  prefix?: string
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  status: 'active' | 'revoked' | 'expired'
}

export interface CreateApiKeyRequest {
  name: string
  expiresAt?: string
}

export interface ApiKeyListResponse {
  keys: ApiKey[]
  total: number
  page?: number
  limit?: number
}

/**
 * Get list of all API keys
 */
export async function getApiKeys(params?: {
  page?: number
  limit?: number
  status?: 'active' | 'revoked' | 'expired'
}): Promise<ApiKeyListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.status) queryParams.append('status', params.status)

  const query = queryParams.toString()
  return apiClient.get<ApiKeyListResponse>(`/api-keys${query ? `?${query}` : ''}`)
}

/**
 * Get a single API key by ID
 */
export async function getApiKey(id: string): Promise<ApiKey> {
  return apiClient.get<ApiKey>(`/api-keys/${id}`)
}

/**
 * Create a new API key
 */
export async function createApiKey(data: CreateApiKeyRequest): Promise<ApiKey> {
  return apiClient.post<ApiKey>('/api-keys', data)
}

/**
 * Update an API key
 */
export async function updateApiKey(
  id: string,
  data: Partial<CreateApiKeyRequest>
): Promise<ApiKey> {
  return apiClient.patch<ApiKey>(`/api-keys/${id}`, data)
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(id: string): Promise<void> {
  return apiClient.post<void>(`/api-keys/${id}/revoke`)
}

/**
 * Delete an API key
 */
export async function deleteApiKey(id: string): Promise<void> {
  return apiClient.delete<void>(`/api-keys/${id}`)
}

