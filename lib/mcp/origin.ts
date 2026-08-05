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

/** Why a request was refused, for the log line. Never returned to the caller. */
export type OriginRejection = { allowed: false; origin: string }
export type OriginCheck = { allowed: true } | OriginRejection

/**
 * Normalises an origin for comparison.
 *
 * Compared as parsed `URL.origin` rather than as raw strings, so a trailing
 * slash or an explicit default port in the allowlist (`https://app.example.com:443`)
 * does not silently fail to match the browser's `https://app.example.com`.
 * An unparseable entry never matches anything, which is the safe direction: a
 * typo in `MCP_ALLOWED_ORIGINS` closes the endpoint to that origin rather than
 * opening it to everything.
 */
function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value)
    // `new URL('null')` throws, but the literal "null" origin (a sandboxed
    // iframe, a data: document) must never be treated as a real one anyway.
    return parsed.origin === 'null' ? null : parsed.origin
  } catch {
    return null
  }
}

/**
 * Decides whether a request may proceed based on its `Origin` header.
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
