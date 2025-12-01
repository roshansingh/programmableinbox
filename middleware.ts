import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for route protection
 * Note: This runs on the edge/server and cannot access localStorage
 * The AuthGuard component handles client-side authentication checks
 * This middleware can be extended for server-side token validation via cookies
 */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = ['/auth/login', '/auth/register']
  const isPublicRoute = publicRoutes.some(route => 
    pathname === route || pathname.startsWith(route + '/')
  )

  // Allow public routes to pass through
  if (isPublicRoute) {
    return NextResponse.next()
  }

  // For protected routes, let the AuthGuard component handle client-side checks
  // In the future, you can add server-side token validation here using cookies
  // For now, we rely on the AuthGuard component for authentication checks
  
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

