/**
 * API Keys API module
 * Handles API key management API calls
 * Targets the dashboard tree at /api/app/apiKeys. Not a published API —
 * these are user-created credentials managed from the dashboard only.
 */

import { apiClient } from '../api-client'
import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_DESCRIPTIONS,
  IMPLIED_IN_UI,
  type ApiKeyScope,
} from '@/lib/api-key-scopes'

export { API_KEY_SCOPES, API_KEY_SCOPE_DESCRIPTIONS, IMPLIED_IN_UI }

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
 * GET /app/apiKeys
 */
export async function getApiKeys(params?: {
  organizationId?: string
}): Promise<ApiKeyListItem[]> {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) {
    queryParams.append('organizationId', params.organizationId)
  }

  const query = queryParams.toString()
  return apiClient.get<ApiKeyListItem[]>(`/app/apiKeys${query ? `?${query}` : ''}`)
}

/**
 * Get a single API key by ID
 * GET /app/apiKeys/{id}
 */
export async function getApiKey(id: string): Promise<ApiKeyListItem> {
  return apiClient.get<ApiKeyListItem>(`/app/apiKeys/${id}`)
}

/**
 * Create a new API key
 * POST /app/apiKeys
 * Note: The full API key is returned only once on creation
 */
export async function createApiKey(data: CreateApiKeyRequest): Promise<CreatedApiKey> {
  return apiClient.post<CreatedApiKey>('/app/apiKeys', data)
}

/**
 * Delete an API key
 * DELETE /app/apiKeys/{id}
 */
export async function deleteApiKey(id: string): Promise<void> {
  return apiClient.delete<void>(`/app/apiKeys/${id}`)
}
