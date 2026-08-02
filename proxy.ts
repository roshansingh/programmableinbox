import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Request proxy for route protection
 * Note: This runs on the edge/server and cannot access localStorage
 * The AuthGuard component handles client-side authentication checks
 * This proxy can be extended for server-side token validation via cookies
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  // Both branches below currently return NextResponse.next(), so this list is
  // documentation of intent rather than enforcement — see CLAUDE.md. Keep it in
  // step with AuthGuard's PUBLIC_ROUTES, which is the gate that actually runs.
  const publicRoutes = ['/auth/login', '/auth/register', '/auth/verify']
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

