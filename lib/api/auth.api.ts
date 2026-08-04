/**
 * Authentication API module
 * Handles signin, register, and authentication-related API calls
 * Based on OpenAPI spec: /auth/register, /auth/login, /auth/me
 */

import { apiClient, setAuthToken, removeAuthToken } from '../api-client'
import type { AppConfig } from '../config/app-config'

export type { AppConfig }

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
  /**
   * Client-visible platform config, served only by `GET /app/auth/me` — the
   * `user` nested in a login/register response does not carry it, hence
   * optional. Read it through `useAuth().config`, never off the user directly.
   */
  config?: AppConfig
}

/**
 * Sign in an existing user
 * POST /app/auth/login
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
 * POST /app/auth/register
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
 * GET /app/auth/me
 */
export async function getCurrentUser(): Promise<User> {
  return apiClient.get<User>('/app/auth/me')
}

/**
 * Redeem a verification link (issue #102)
 * POST /app/auth/verification/confirm
 *
 * Unauthenticated on purpose — the link is routinely opened on a device that
 * holds no session. The token is the credential.
 */
export async function confirmEmailVerification(token: string): Promise<{ verified: boolean }> {
  return apiClient.post<{ verified: boolean }>('/app/auth/verification/confirm', { token })
}

/**
 * Request another verification email for the signed-in user
 * POST /app/auth/verification/resend
 *
 * Takes no address: the server sends to the principal's own, so this cannot be
 * aimed at anyone else. Throws an ApiError with status 429 while the cooldown
 * is in effect.
 */
export async function resendVerificationEmail(): Promise<{ sent: boolean }> {
  return apiClient.post<{ sent: boolean }>('/app/auth/verification/resend')
}

/**
 * Starts a password reset. Resolves the same way whether or not the address
 * has an account — see the route for why.
 */
export async function requestPasswordReset(email: string): Promise<{ requested: boolean }> {
  return apiClient.post<{ requested: boolean }>('/app/auth/password-reset/request', { email })
}

/** Completes a password reset. Returns no session — the user signs in after. */
export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<{ reset: boolean }> {
  return apiClient.post<{ reset: boolean }>('/app/auth/password-reset/confirm', {
    token,
    password,
  })
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

