"use client"

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { VerifyEmailNotice } from '@/components/verify-email-notice'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * `/auth/verify` is public because the link is routinely opened on a device
 * holding no session (issue #102 §8.5). Note it is deliberately NOT added to
 * `AuthProvider`'s own public list: that one controls whether `/auth/me` is
 * fetched, and the verify page needs to know whether a session exists so it
 * can refresh the user and continue instead of asking them to log in. The
 * resulting 401 for a signed-out visitor is harmless — `lib/api-client` skips
 * its redirect for any path under `/auth/`.
 */
const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/auth/verify', '/api-docs']

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isLoading, isAuthenticated, user, config } = useAuth()

  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  )

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

  return <>{children}</>
}
