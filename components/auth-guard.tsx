"use client"

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser } from '@/lib/api/auth.api'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * AuthGuard component
 * Protects routes by checking authentication status via session
 * Verifies authentication by calling /auth/me endpoint
 * Redirects to /auth/login if not authenticated
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isChecking, setIsChecking] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    const verifyAuth = async () => {
      // Public routes that don't require authentication
      const publicRoutes = ['/auth/login', '/auth/register']
      const isPublicRoute = publicRoutes.some(route => 
        pathname === route || pathname.startsWith(route + '/')
      )

      // If it's a public route, allow access
      if (isPublicRoute) {
        setIsChecking(false)
        setIsAuthenticated(false)
        return
      }

      // Verify authentication by calling /auth/me
      try {
        await getCurrentUser()
        // If successful, user is authenticated
        setIsAuthenticated(true)
        setIsChecking(false)
      } catch (error) {
        // If /auth/me fails, user is not authenticated
        setIsAuthenticated(false)
        setIsChecking(false)
        // Redirect to login, preserving the intended destination
        router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`)
      }
    }

    verifyAuth()
  }, [pathname, router])

  // Show loading state while checking
  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // If not authenticated and not a public route, don't render children (redirect is happening)
  if (!isAuthenticated && !['/auth/login', '/auth/register'].some(route => 
    pathname === route || pathname.startsWith(route + '/')
  )) {
    return null
  }

  return <>{children}</>
}

