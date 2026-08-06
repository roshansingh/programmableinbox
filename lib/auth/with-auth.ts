import 'server-only'
import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { resolveUserPrincipalFromToken } from '@/lib/auth-server'
import { resolveApiKeyPrincipal } from './api-key-auth'
import { tagHandler } from './route-tags'
import { API_KEY_PREFIX, resolveScope, type ApiKeyScope } from '@/lib/api-key-scopes'
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
): RouteHandler<P>
/**
 * Opt a route out of the email-verification gate (issue #102).
 *
 * Deliberately an opt-*out*: verification is required by default, so a new
 * route that forgets to think about it fails closed. The literal `true` is
 * required so the intent is unmistakable at the call site — and so the guard
 * in lib/__tests__/route-guards.test.ts, which pins the exact set of opted-out
 * routes, is checking something a reviewer can also see.
 */
export function withUser<P = Record<string, never>>(
  options: { allowUnverified: true },
  handler: PrincipalHandler<UserPrincipal, P>,
): RouteHandler<P>
export function withUser<P = Record<string, never>>(
  optionsOrHandler: { allowUnverified: true } | PrincipalHandler<UserPrincipal, P>,
  maybeHandler?: PrincipalHandler<UserPrincipal, P>,
): RouteHandler<P> {
  const allowUnverified = typeof optionsOrHandler === 'object'
  const handler = (allowUnverified ? maybeHandler! : optionsOrHandler) as PrincipalHandler<
    UserPrincipal,
    P
  >

  return tagHandler(
    async (request: NextRequest, context: RouteCtx<P>) => {
      const credential = bearer(request)
      if (!credential || looksLikeApiKey(credential)) {
        return jsonError('Unauthorized', 401)
      }

      const principal = await resolveUserPrincipalFromToken(credential)
      if (!principal) return jsonError('Unauthorized', 401)

      // A soft gate: the session is real and stays real, but the dashboard is
      // closed until the address is proven. 403 rather than 401 on purpose —
      // 401 makes lib/api-client drop the token and bounce to /auth/login,
      // which would log the user out of the very screen that offers Resend.
      if (
        !allowUnverified &&
        !principal.emailVerified &&
        config.emailVerification.enabled
      ) {
        return jsonError('Email verification required', 403)
      }

      return handler(request, principal, context)
    },
    'user',
    { allowUnverified },
  )
}

/**
 * External API routes. API key only — a JWT is rejected without verification.
 *
 * Scopes are declared per route and checked here, so a handler can never be
 * reached without its scope having been satisfied. This is the fix for the
 * PATCH route that gated a write behind `messages:read`: the scope now lives
 * in the wrapper call, next to the HTTP method, rather than buried in the
 * handler body where it drifted unnoticed.
 *
 * There is deliberately **no email-verification check here** (issue #102 §6.4).
 * A key can only be minted from the dashboard, which is itself behind the gate,
 * so an unverified user cannot obtain one; and every key that existed before
 * the feature shipped belongs to a user the backfill migration grandfathered.
 * Adding a check would cost a `User` lookup on every external API request in
 * order to enforce a state that is unreachable by construction.
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

    // Resolved rather than compared raw, so a key whose row the rename
    // migration has not reached yet still authorizes. `resolveScope` maps only
    // the two retired read names, so this cannot widen a key onto
    // `email_inboxes:write`.
    const held = new Set(principal.scopes.map(resolveScope))

    // Reported by their current names. A holder cannot act on `inboxes:read`:
    // it is not a name the dashboard offers any more, so echoing what is
    // stored would send them looking for a scope that no longer exists.
    const missing = options.scopes.filter((scope) => !held.has(scope))
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
