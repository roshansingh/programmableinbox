/**
 * DNS-rebinding defense for `POST /api/mcp` (issue #104).
 *
 * The MCP transport spec makes origin validation a MUST for HTTP servers. The
 * attack it closes: a page the victim visits resolves a hostname it controls to
 * 127.0.0.1 (or to an internal address), then has the victim's browser POST to
 * the MCP endpoint. The browser attaches whatever ambient credentials it holds
 * and the page reads the reply — unless the server refuses requests from an
 * origin it does not recognise.
 *
 * Two things about the shape of the check are deliberate.
 *
 * **A missing `Origin` is allowed; a present-and-unknown one is refused.**
 * `Origin` is a header browsers attach and script cannot forge. Non-browser
 * callers — Claude Code, Cursor, VS Code, claude.ai's server-side connector
 * fetcher, curl — send none, which is exactly the population this endpoint
 * serves. So "absent" is the normal case and carries no rebinding risk, while
 * "present" means a browser is calling and must be on the list. This is not the
 * weaker "allow if absent" of a CSRF token check: there is no ambient
 * credential here to abuse, because the only accepted credential is an
 * `Authorization` header a browser will not attach on its own.
 *
 * **The expected origin is operator configuration, never derived from the
 * request.** `Host` and `X-Forwarded-Host` are both attacker-controllable in
 * the rebinding scenario — comparing `Origin` against them lets the attacker
 * supply both sides and always match. Same reasoning that made `APP_BASE_URL`
 * operator-set rather than request-derived.
 */

import { normalizeOrigin } from '@/lib/config/primitives'

/** Why a request was refused, for the log line. Never returned to the caller. */
export type OriginRejection = { allowed: false; origin: string }
export type OriginCheck = { allowed: true } | OriginRejection

/**
 * Decides whether a request may proceed based on its `Origin` header.
 *
 * Allowlist entries are normalised again here rather than assumed valid. That
 * is defence in depth, not distrust of the caller: `config.mcp.allowedOrigins`
 * is already canonicalised and boot-validated, so in production the filter
 * below removes nothing. It matters because this is a pure function with its
 * own tests and no way to enforce where its input came from — a future caller
 * passing a hand-built array must not be able to turn a typo into a match.
 *
 * @param origin the raw header value, or null when absent
 * @param allowedOrigins `config.mcp.allowedOrigins` — empty by default
 */
export function checkOrigin(
  origin: string | null,
  allowedOrigins: readonly string[],
): OriginCheck {
  if (origin === null) return { allowed: true }

  const requested = normalizeOrigin(origin)
  if (requested === null) return { allowed: false, origin }

  const permitted = allowedOrigins
    .map(normalizeOrigin)
    .filter((value): value is string => value !== null)

  return permitted.includes(requested) ? { allowed: true } : { allowed: false, origin }
}
