/**
 * Authentication API module
 * Handles signin, register, and authentication-related API calls
 * Based on OpenAPI spec: /auth/register, /auth/login, /auth/me
 */

import { apiClient, setAuthToken, removeAuthToken } from '../api-client'

/**
 * Sign in request DTO
 * Matches SignInDto from OpenAPI spec
 */
export interface SignInRequest {
  email: string
  password: string
}

/**
 * Sign up request DTO
 * Matches SignUpDto from OpenAPI spec
 */
export interface SignUpRequest {
  email: string
  password: string
  firstName?: string
  lastName?: string
}

/**
 * Auth response (token structure may vary based on backend implementation)
 */
export interface AuthResponse {
  token?: string
  accessToken?: string
  access_token?: string
  user?: User
}

/**
 * Organization information
 */
export interface Organization {
  id: string
  name: string
  slug: string
  role: string
  createdAt: string
  updatedAt: string
}

/**
 * User information
 */
export interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  emailVerified: boolean
  organizations: Organization[]
}

/**
 * Sign in an existing user
 * POST /auth/login
 */
export async function signIn(credentials: SignInRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/app/auth/login', credentials)
  
  // Store token after successful sign in
  // Handle different possible token field names
  const token = response.token || response.accessToken || response.access_token
  if (token) {
    setAuthToken(token)
  }
  
  return response
}

/**
 * Register a new user
 * POST /auth/register
 */
export async function signUp(data: SignUpRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/app/auth/register', data)
  
  // Store token after successful registration
  // Handle different possible token field names
  const token = response.token || response.accessToken || response.access_token
  if (token) {
    setAuthToken(token)
  }
  
  return response
}

/**
 * Get current user information
 * GET /auth/me
 */
export async function getCurrentUser(): Promise<User> {
  return apiClient.get<User>('/app/auth/me')
}

/**
 * Logout user (client-side only)
 * Removes token from storage
 * Note: No backend endpoint exists for logout in the OpenAPI spec
 */
export function logout(): void {
  removeAuthToken()
}

// Legacy function names for backward compatibility
/**
 * @deprecated Use signIn instead
 */
export async function login(credentials: SignInRequest): Promise<AuthResponse> {
  return signIn(credentials)
}

/**
 * @deprecated Use signUp instead
 */
export async function register(data: SignUpRequest): Promise<AuthResponse> {
  return signUp(data)
}

