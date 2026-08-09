"use client"

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { VerifyEmailNotice } from '@/components/verify-email-notice'
import { UsageBanner } from '@/components/usage-banner'
import { isPublicPath } from '@/lib/auth/public-routes'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isLoading, isAuthenticated, user, config } = useAuth()

  // The gate that actually runs. `AuthProvider` matches against a narrower
  // list — see SESSION_FETCH_SKIPPED_ROUTES for the one route that differs.
  const isPublicRoute = isPublicPath(pathname)

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublicRoute) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`)
    }
  }, [isLoading, isAuthenticated, isPublicRoute, pathname, router])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!isAuthenticated && !isPublicRoute) {
    return null
  }

  // The client half of the soft gate (issue #102 §8.2). Cosmetic, not
  // enforcement: `withUser` returns 403 for the same user whatever this
  // renders. It exists so an unverified user sees an explanation and a Resend
  // button rather than a dashboard where every panel fails to load.
  //
  // `/auth/verify` is exempt so that a signed-in unverified user clicking
  // their own link on the same device is not bounced away from the one page
  // that would have cleared the gate.
  if (
    isAuthenticated &&
    config.emailVerificationRequired &&
    user &&
    !user.emailVerified &&
    !pathname.startsWith('/auth/verify')
  ) {
    return <VerifyEmailNotice />
  }

  // Above the dashboard rather than inside a page, so a user who is over quota
  // sees it wherever they are. Renders nothing at all when the deployment has
  // no plan (issue #117 §7d).
  return (
    <>
      <UsageBanner />
      {children}
    </>
  )
}
