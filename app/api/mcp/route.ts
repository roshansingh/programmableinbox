import { createMcpHandler } from 'mcp-handler'
import { withApiKey } from '@/lib/auth/with-auth'
import { jsonError } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { checkOrigin } from '@/lib/mcp/origin'
import { SERVER_INFO } from '@/lib/mcp/server-info'
import { registerEmailTools } from '@/lib/mcp/tools'
import { consumeRateLimit, rateLimitHeaders } from '@/lib/security/rate-limit'
import logger from '@/lib/logger'

/**
 * The MCP server (issue #104) — the fourth route tree.
 *
 * `withApiKey({ scopes: [] })` looks like a wrapper that checks nothing, and
 * that is the point. The empty array satisfies the route-level AND-check
 * trivially while still resolving the key, enforcing revocation and expiry, and
 * attaching the `'apiKey'` route tag the structural guards read. Scopes are
 * then enforced per *tool*, because a single route-level declaration cannot
 * express "this call needs inboxes:read and that one needs messages:read" when
 * both arrive down the same POST.
 *
 * A JWT is rejected before any verification, by prefix, exactly as on every
 * other API-key route — the RFC 8725 §2.8 cross-JWT confusion class this repo
 * already removed once.
 */

export const POST = withApiKey({ scopes: [] }, async (request, principal) => {
  // Checked after authentication rather than before: an unauthenticated probe
  // is already rejected by the wrapper without touching the database, so
  // ordering it this way costs nothing and keeps the whole handler inside the
  // wrapper that tags it. While disabled the route 404s rather than 403s — a
  // feature that is off should not advertise that it exists.
  if (!config.mcp.enabled) {
    return jsonError('Not found', 404)
  }

  // DNS-rebinding defense, a MUST in the transport spec. See lib/mcp/origin.ts
  // for why absent-is-allowed and why the expected origin is operator
  // configuration rather than anything derived from the request.
  const origin = checkOrigin(request.headers.get('origin'), config.mcp.allowedOrigins)
  if (!origin.allowed) {
    logger.warn(
      { origin: origin.origin, apiKeyId: principal.apiKeyId },
      'Rejected MCP request from a disallowed origin',
    )
    return jsonError('Origin not allowed', 403)
  }

  // Keyed on the API key rather than the client address: the caller is
  // identified by a credential we issued, which is a stabler bucket than an
  // address behind a shared NAT, and it is available on every request here
  // (unlike a trustworthy IP, which `getClientIp` returns null for whenever no
  // proxy hop can be trusted). Same limiter as auth, a different scope string.
  const decision = await consumeRateLimit('mcp', principal.apiKeyId, {
    limit: config.mcp.rateLimitMax,
    windowMs: config.mcp.rateLimitWindowS * 1000,
  })

  if (!decision.allowed) {
    return jsonError('Too many requests', 429, rateLimitHeaders(decision))
  }

  /**
   * Built per request, closing over this request's principal.
   *
   * The transport is stateless — the spec revision this SDK implements has no
   * sessions to keep — so there is nothing to reuse between requests, and a
   * module-level server would need the principal to travel in a mutable global
   * that concurrent requests would race on. Constructing six tool definitions
   * is object allocation, not I/O.
   */
  const handler = createMcpHandler(
    (server) => {
      registerEmailTools(server, principal)
    },
    { serverInfo: SERVER_INFO },
  )

  // Returned verbatim: this is a JSON-RPC envelope, not our `{ data }` one. A
  // deliberate exception to the jsonSuccess rule in lib/api-helpers — wrapping
  // it would make the response unparseable to every MCP client, and
  // lib/api-client.ts (which auto-unwraps `data.data`) never calls this route.
  return handler(request)
})
