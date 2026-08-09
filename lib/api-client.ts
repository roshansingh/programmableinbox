/**
 * Base API client for making HTTP requests to the backend
 * Handles authentication, error handling, and request/response transformation
 */

const API_BASE_URL = (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000') + '/api'

export interface ApiError {
  message: string
  status: number
  errors?: Record<string, string[]>
  /**
   * Present on a 402 plan denial (issue #117 §6b), where the server sends
   * `limit`, `used` and `planCode` alongside the message so the UI can render
   * an accurate upsell — "1 of 1 inboxes used" — rather than a bare sentence.
   *
   * Undefined on every other error. `limit` may legitimately be `0`, meaning
   * "none allowed", so callers must check for `undefined` rather than falsiness.
   */
  limit?: number
  used?: number
  planCode?: string
}

export interface ApiResponse<T> {
  data: T
  message?: string
}

/**
 * Get authentication token from storage
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

/**
 * Set authentication token in storage
 */
export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token)
  }
}

/**
 * Remove authentication token from storage
 */
export function removeAuthToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token')
  }
}

/**
 * Build full URL from endpoint
 */
function buildUrl(endpoint: string): string {
  // If endpoint is already a full URL, return it
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint
  }
  
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  return `${API_BASE_URL}/${cleanEndpoint}`
}

/**
 * Create headers for API requests
 * Ensures Content-Type: application/json is always set and cannot be overridden
 */
function createHeaders(customHeaders?: HeadersInit): HeadersInit {
  // Convert custom headers to a Record for easier manipulation
  const headers: Record<string, string> = {}
  
  // If customHeaders is provided, convert it to a Record
  if (customHeaders) {
    if (customHeaders instanceof Headers) {
      customHeaders.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(customHeaders)) {
      customHeaders.forEach(([key, value]) => {
        headers[key] = value
      })
    } else {
      Object.assign(headers, customHeaders)
    }
  }

  // Always set Content-Type to application/json (cannot be overridden by custom headers)
  headers['Content-Type'] = 'application/json'

  // Add Authorization header if token exists
  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

/**
 * Handle API response and extract data or throw error
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type')
  const isJson = contentType?.includes('application/json')

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`
    let errors: Record<string, string[]> | undefined
    let planDetail: { limit?: unknown; used?: unknown; planCode?: unknown } = {}

    if (isJson) {
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
        errors = errorData.errors
        planDetail = errorData
      } catch {
        // If JSON parsing fails, use default error message
      }
    } else {
      try {
        errorMessage = await response.text() || errorMessage
      } catch {
        // If text parsing fails, use default error message
      }
    }

    const error: ApiError = {
      message: errorMessage,
      status: response.status,
      errors,
      // Forwarded rather than dropped: `jsonPlanDenial` sends these on a 402 so
      // the UI can show what the cap was and how much of it is used. They were
      // being parsed into `errorData` above and then discarded, which made the
      // richer body unreachable from any call site.
      ...(typeof planDetail.limit === 'number' ? { limit: planDetail.limit } : {}),
      ...(typeof planDetail.used === 'number' ? { used: planDetail.used } : {}),
      ...(typeof planDetail.planCode === 'string' ? { planCode: planDetail.planCode } : {}),
    }

    // Handle 401 Unauthorized - clear token and redirect to login
    // Skip redirect if already on an auth page to avoid reload loops
    if (response.status === 401) {
      removeAuthToken()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
        window.location.href = '/auth/login'
      }
    }

    throw error
  }

  // Handle empty responses
  if (response.status === 204 || response.status === 201 && !isJson) {
    return undefined as T
  }

  if (isJson) {
    const data = await response.json()
    // If response has a data property, return it; otherwise return the whole response
    return data.data !== undefined ? data.data : data
  }

  return (await response.text()) as T
}

/**
 * Base fetch function with error handling and authentication
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = buildUrl(endpoint)
  
  // Create headers - Content-Type: application/json is always set
  const headers = createHeaders(options.headers)

  const config: RequestInit = {
    ...options,
    headers,
    // Include credentials (cookies) for session-based authentication
    credentials: 'include',
  }

  try {
    const response = await fetch(url, config)
    return await handleResponse<T>(response)
  } catch (error) {
    // Re-throw ApiError as-is
    if (error && typeof error === 'object' && 'status' in error) {
      throw error
    }

    // Handle network errors
    throw {
      message: error instanceof Error ? error.message : 'Network error occurred',
      status: 0,
    } as ApiError
  }
}

/**
 * API client methods
 */
export const apiClient = {
  /**
   * GET request
   */
  get: <T = unknown>(endpoint: string, options?: RequestInit): Promise<T> => {
    return apiFetch<T>(endpoint, {
      ...options,
      method: 'GET',
    })
  },

  /**
   * POST request
   */
  post: <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> => {
    return apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * PUT request
   */
  put: <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> => {
    return apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * PATCH request
   */
  patch: <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> => {
    return apiFetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * DELETE request
   */
  delete: <T = unknown>(endpoint: string, options?: RequestInit): Promise<T> => {
    return apiFetch<T>(endpoint, {
      ...options,
      method: 'DELETE',
    })
  },
}

