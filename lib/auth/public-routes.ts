/**
 * The single list of pages reachable without a session, and the matcher that
 * decides membership.
 *
 * This lived in three places — `components/auth-guard.tsx`,
 * `components/auth-provider.tsx` and `proxy.ts` — each with its own copy of the
 * array *and* of the prefix-matching rule. They were not identical, and the
 * drift was not visible from any one of them: `/auth/forgot-password` and
 * `/auth/reset-password` shipped with the password-reset feature and were added
 * to none of the three, so the only page a user who cannot log in would ever
 * visit redirected them to the login page.
 *
 * Imports nothing. `proxy.ts` runs in the proxy runtime and `AuthGuard` runs in
 * the browser, so anything pulled in here would land in both.
 */

/**
 * Pages that render without a session.
 *
 * `/auth/verify` and `/auth/reset-password` are here because the link is
 * routinely opened on a device holding no session; `/auth/forgot-password`
 * because a user who could log in would not be there. `/api-docs` is public by
 * product decision (see CLAUDE.md).
 *
 * Entries match exactly or as a path prefix — `/auth/verify` covers
 * `/auth/verify/anything`, and `/auth/verify-x` is not a match.
 */
export const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/verify',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/api-docs',
] as const

/**
 * Public routes on which `AuthProvider` also skips its `/auth/me` call.
 *
 * Derived rather than written out, because it differs from {@link PUBLIC_ROUTES}
 * by exactly one deliberate exception and that is the sort of relationship a
 * second hand-maintained array loses.
 *
 * `/auth/verify` is excluded: a signed-in user clicking their own verification
 * link needs the page to resolve their session so it can refresh the user in
 * place, rather than being asked to log in again (issue #102 §8.5). The
 * password-reset pages need no such thing — confirm issues no session and the
 * user signs in afterwards — so fetching there could only ever produce a 401.
 */
export const SESSION_FETCH_SKIPPED_ROUTES = PUBLIC_ROUTES.filter(
  (route) => route !== '/auth/verify',
)

/**
 * True when `pathname` is the route itself or sits beneath it.
 *
 * The `+ '/'` is what keeps the prefix honest: a bare `startsWith` would make
 * `/auth/login-as-someone-else` public on the strength of the shared stem.
 */
export function isPublicPath(
  pathname: string,
  routes: readonly string[] = PUBLIC_ROUTES,
): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(route + '/'))
}
