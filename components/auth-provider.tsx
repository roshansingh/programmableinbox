"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import posthog from "posthog-js"
import { getCurrentUser, type User, type AppConfig, type OrganizationPlan } from "@/lib/api/auth.api"
import { isPublicPath, SESSION_FETCH_SKIPPED_ROUTES } from "@/lib/auth/public-routes"

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
  /**
   * The current organization's plan (issue #117 §7b), or `null` when the
   * deployment runs without `USE_COMMERCIAL`.
   *
   * **Null means "no plan restrictions", not "no access."** A self-hosted
   * install never sends this, so every consumer must treat its absence as
   * unlimited — the opposite of `config`, where empty is fail-closed.
   */
  plan: OrganizationPlan | null
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
  // Same fail-closed reading: no instrumentation until the server says
  // otherwise, so nothing calls posthog.init() before /auth/me resolves.
  productAnalyticsEnabled: false,
  posthogApiKey: null,
  posthogHost: null,
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const pathname = usePathname()

  const organizationId = user?.organizations?.[0]?.id ?? null
  const config = user?.config ?? EMPTY_CONFIG
  // Same `[0]` as organizationId above: one organization per user is the
  // working assumption for the client. The server never relies on it —
  // enforcement always resolves a concrete organization — so a future org
  // switcher is a UI change, not a migration.
  const plan = user?.organizations?.[0]?.plan ?? null

  // Narrower than AuthGuard's gate: this decides whether `/auth/me` is called
  // at all, and `/auth/verify` needs the session it would otherwise skip.
  const isPublicRoute = isPublicPath(pathname, SESSION_FETCH_SKIPPED_ROUTES)

  const refreshUser = async () => {
    try {
      const userData = await getCurrentUser()
      setUser(userData)
      setIsAuthenticated(true)

      // Both calls are gated on the same config.productAnalyticsEnabled flag
      // ProductAnalyticsProvider uses for posthog.init() — a call here before
      // init() has run is a harmless no-op in posthog-js (it warns to the
      // console rather than throwing), and React fires a child's mount effect
      // before its parent's, so ProductAnalyticsProvider (a sibling mounted
      // ahead of AuthGuard in app/layout.tsx, both children of this provider)
      // has already initialized by the time this effect runs in practice.
      //
      // Wrapped in its own try/catch, deliberately separate from the outer
      // one: this is telemetry, not part of resolving the session, and it
      // must not be able to fall into the outer catch below and undo the
      // setUser/setIsAuthenticated calls just above — an instrumentation
      // hiccup (an ad-blocker, a PostHog outage) must never look like an
      // authentication failure to the rest of the app.
      if (userData.config?.productAnalyticsEnabled) {
        try {
          posthog.identify(userData.id, { email: userData.email })

          const organization = userData.organizations?.[0]
          if (organization) {
            posthog.group('organization', organization.id, { plan: organization.plan?.code })
          }
        } catch {
          // Best-effort. Nothing to recover, nothing to surface — the user's
          // session is already established at this point.
        }
      }
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
    <AuthContext.Provider value={{ user, organizationId, config, plan, isLoading, isAuthenticated, refreshUser }}>
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
