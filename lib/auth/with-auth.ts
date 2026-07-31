import 'server-only'
import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api-helpers'
import { resolveUserPrincipalFromToken } from '@/lib/auth-server'
import { resolveApiKeyPrincipal } from './api-key-auth'
import { tagHandler } from './route-tags'
import { API_KEY_PREFIX, type ApiKeyScope } from '@/lib/api-key-scopes'
import type { UserPrincipal, ApiKeyPrincipal } from './principals'

export type RouteCtx<P = Record<string, never>> = { params: Promise<P> }

export type RouteHandler<P = Record<string, never>> = (
  request: NextRequest,
  context: RouteCtx<P>,
) => Promise<Response>

export type PrincipalHandler<TPrincipal, P = Record<string, never>> = (
  request: NextRequest,
  principal: TPrincipal,
  context: RouteCtx<P>,
) => Promise<Response>

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}

function looksLikeApiKey(credential: string): boolean {
  return credential.startsWith(API_KEY_PREFIX)
}

/**
 * Dashboard routes. JWT only — an API key is rejected without a lookup.
 *
 * The credential type is decided by prefix BEFORE any verification runs. The
 * previous resolver verified a JWT first and fell back to an API-key hash
 * lookup on the same header value, which is the "Cross-JWT Confusion"
 * substitution class named in RFC 8725 §2.8. It also made every API-key
 * request pay a jwt.verify, reported expired JWTs as bad keys, and — because
 * getJwtSecret() throws outside verifyToken's try block — let a misconfigured
 * JWT_SECRET return 500 for perfectly valid API-key traffic.
 */
export function withUser<P = Record<string, never>>(
  handler: PrincipalHandler<UserPrincipal, P>,
): RouteHandler<P> {
  return tagHandler(async (request: NextRequest, context: RouteCtx<P>) => {
    const credential = bearer(request)
    if (!credential || looksLikeApiKey(credential)) {
      return jsonError('Unauthorized', 401)
    }

    const principal = await resolveUserPrincipalFromToken(credential)
    if (!principal) return jsonError('Unauthorized', 401)

    return handler(request, principal, context)
  }, 'user')
}

/**
 * External API routes. API key only — a JWT is rejected without verification.
 *
 * Scopes are declared per route and checked here, so a handler can never be
 * reached without its scope having been satisfied. This is the fix for the
 * PATCH route that gated a write behind `messages:read`: the scope now lives
 * in the wrapper call, next to the HTTP method, rather than buried in the
 * handler body where it drifted unnoticed.
 */
export function withApiKey<P = Record<string, never>>(
  options: { scopes: readonly ApiKeyScope[] },
  handler: PrincipalHandler<ApiKeyPrincipal, P>,
): RouteHandler<P> {
  return tagHandler(async (request: NextRequest, context: RouteCtx<P>) => {
    const credential = bearer(request)
    if (!credential || !looksLikeApiKey(credential)) {
      return jsonError('Unauthorized', 401)
    }

    const principal = await resolveApiKeyPrincipal(credential)
    if (!principal) return jsonError('Unauthorized', 401)

    const missing = options.scopes.filter((scope) => !principal.scopes.includes(scope))
    if (missing.length > 0) {
      return jsonError(`Missing required scope: ${missing.join(', ')}`, 403)
    }

    return handler(request, principal, context)
  }, 'apiKey')
}

/**
 * Deliberately unauthenticated routes: login, register, and the provider
 * ingest handlers that verify their own signatures.
 *
 * This performs no authentication. It exists so that "no auth here on purpose"
 * is distinguishable from "someone forgot the wrapper" — without it, guard 5
 * in lib/__tests__/route-guards.test.ts cannot tell those apart, and an
 * unwrapped handler is invisible to every other guard.
 */
export function withPublic<P = Record<string, never>>(
  handler: RouteHandler<P>,
): RouteHandler<P> {
  return tagHandler(handler, 'public')
}
