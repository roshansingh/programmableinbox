/**
 * Authentication utilities
 * Client-side only functions for checking authentication status
 */

/**
 * Check if user is authenticated (has token in localStorage)
 * Client-side only
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false
  const token = localStorage.getItem('auth_token')
  return !!token
}

/**
 * Get authentication token
 * Client-side only
 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

