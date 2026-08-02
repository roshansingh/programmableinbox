"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { getCurrentUser, type User, type AppConfig } from "@/lib/api/auth.api"

interface AuthContextValue {
  user: User | null
  organizationId: string | null
  /**
   * Client-visible platform config from `GET /app/auth/me` (issue #98).
   * Always an object, so consumers never branch on null — but a server that
   * has not been configured yields empty values, and every consumer must treat
   * that as "this feature is unavailable" rather than "no restrictions".
   */
  config: AppConfig
  isLoading: boolean
  isAuthenticated: boolean
  refreshUser: () => Promise<void>
}

/**
 * Used before `/auth/me` resolves and whenever the server sends no `config`.
 * Empty on purpose: an empty domain list disables inbox creation, which is the
 * fail-closed direction. Defaulting to anything permissive here would
 * reintroduce the bug on the client.
 */
const EMPTY_CONFIG: AppConfig = {
  emailInboxDomains: [],
  // False is the fail-closed reading for this one: "the deployment does not
  // have this feature", so the client renders normally and the server's 403 —
  // which is the actual gate — decides. Defaulting to true would show every
  // user a verify-your-email wall for the moment before /auth/me resolves,
  // including on deployments that never enabled it.
  emailVerificationRequired: false,
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/api-docs']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const pathname = usePathname()

  const organizationId = user?.organizations?.[0]?.id ?? null
  const config = user?.config ?? EMPTY_CONFIG

  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  )

  const refreshUser = async () => {
    try {
      const userData = await getCurrentUser()
      setUser(userData)
      setIsAuthenticated(true)
    } catch {
      setUser(null)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Skip auth check for public routes
    if (isPublicRoute) {
      setIsLoading(false)
      return
    }
    refreshUser()
  }, [isPublicRoute])

  return (
    <AuthContext.Provider value={{ user, organizationId, config, isLoading, isAuthenticated, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
