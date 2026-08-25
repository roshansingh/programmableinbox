/**
 * Authentication API module
 * Handles signin, register, and authentication-related API calls
 * Based on OpenAPI spec: /auth/register, /auth/login, /auth/me
 */

import { apiClient } from '../api-client'
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
/**
 * The plan limits the browser is allowed to see (issue #117 §7b).
 *
 * A partial mirror of the server's `PlanLimits`: only the keys the UI actually
 * branches on. `null` means unlimited — never zero, which is a real limit
 * meaning "none allowed".
 */
export interface PlanLimits {
  emailInboxes: number | null
  phoneInboxes: number | null
  apiKeys: number | null
  webhooks: number | null
  automations: number | null
  incomingEmailsPerPeriod: number | null
  outboundEmailsPerPeriod: number | null
  outboundEmail: boolean
  llmEnrichment: boolean
  automationsEnabled: boolean
  phoneInboxesEnabled: boolean
  overQuotaBehavior: 'drop' | 'overage'
  // Deliberately no index signature. The server sends more keys than these, and
  // TypeScript accepts extra properties on a value it receives — an index
  // signature is not needed to tolerate them, and adding one would make every
  // typo (`plan.limits.emailInboxs`) a valid access that silently reads
  // undefined.
}

/**
 * Present only when the deployment runs with `USE_COMMERCIAL=true`. Its absence
 * is the self-hosted case and must read as "no plan restrictions".
 */
export interface OrganizationPlan {
  code: string
  name: string
  limits: PlanLimits
}

export interface Organization {
  id: string
  name: string
  slug: string
  role: string
  createdAt: string
  updatedAt: string
  /**
   * Per-organization, alongside `role`, rather than on `config` — a plan is
   * tenant-scoped and `AppConfig` is deployment-scoped, so there is no correct
   * single value for a user in two organizations.
   */
  plan?: OrganizationPlan
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
  return apiClient.post<AuthResponse>('/app/auth/login', credentials)
}

/**
 * Register a new user
 * POST /app/auth/register
 */
export async function signUp(data: SignUpRequest): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/app/auth/register', data)
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
 * Logout user
 * POST /app/auth/logout — clears the httpOnly session cookie server-side.
 * The client holds no credential of its own to remove.
 */
export async function logout(): Promise<void> {
  await apiClient.post('/app/auth/logout')
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

