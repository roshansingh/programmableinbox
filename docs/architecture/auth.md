# Authentication

ProgrammableInbox uses **JWTs, not cookie sessions**. This doc covers how a request gets
authenticated, the three wrappers every route is built on, and the client-side gate.

## Two credential types, resolved before verification

A request carries one of two credential types in its `Authorization: Bearer <token>` header:

- A **session JWT**, issued at login, carrying `{ userId }` (plus a few housekeeping claims).
- An **API key**, prefixed `sk_live_`, created from the dashboard.

`lib/auth/with-auth.ts` decides which one it's looking at **by the `sk_live_` prefix, before any
verification runs** — not by trying a JWT verify and falling back to an API-key lookup on
failure. That ordering matters: the superseded approach verified a JWT first and fell back to an
API-key lookup on the same header value, which is the shape of
[RFC 8725 §2.8 Cross-JWT Confusion](https://www.rfc-editor.org/rfc/rfc8725#section-2.8) — a
token minted for one purpose gets accepted somewhere it was never meant to work. Deciding the
type up front, from a property of the string itself, avoids that class of bug entirely rather
than patching around it.

## The three wrappers

Every route handler is one of these three, declared where the route is defined:

- **`withUser`** — JWT only, via `resolveUserPrincipalFromToken`. An API key is rejected without
  a lookup.
- **`withApiKey({ scopes })`** — API key only, via `resolveApiKeyPrincipal`. A JWT is rejected
  without verification, and the declared scopes are checked before the handler body runs. See
  [multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md) for what scopes exist.
- **`withPublic`** — no authentication. This exists so "deliberately open" is visibly a decision
  in the code, not something you have to infer from the absence of a wrapper.

A route handler never authenticates itself — it trusts whichever wrapper it's declared inside.
`lib/__tests__/route-guards.test.ts` enforces the route-tree table in
[README.md](README.md#the-four-route-trees) structurally, by importing every route module and
checking a symbol the wrappers attach on success. Source-text matching can't tell you "was this
wrapper actually applied" — only running it can, so the guard reads the runtime evidence.

`getAuthenticatedUser` survives for `/api/app/auth/me` only, inside `withUser`, because
`formatUserResponse` there needs the `Organization` relation that the principal resolver
deliberately doesn't load for every other route (loading it everywhere would be a wasted join on
every authenticated request).

## The client side

- The token lives in `localStorage.auth_token`.
- `apiClient` (`lib/api-client.ts`) attaches `Authorization: Bearer <token>` to every request. On
  a `401` it clears the token and redirects to `/auth/login`, unless already on an auth page.
- `<AuthGuard>` (in `app/layout.tsx`) is the client-side gate: it redirects an unauthenticated
  user to `/auth/login`.
- `<AuthProvider>` calls `GET /api/app/auth/me` once on mount and shares the result via
  `useAuth()`. **Fetch the user through that context — don't call `/auth/me` yourself** from a
  component; it's a shared fetch, not a per-component one.
- `proxy.ts` (the Next.js 16 successor to `middleware.ts`) excludes `/api` from its matcher.
  **All real auth enforcement is per-route, via the three wrappers above — not at the proxy
  layer.** The proxy only does pass-through for public pages.

### Public routes, one list

`/auth/*`, `/api-docs` (Swagger docs), and `/api/app/auth/{login,register,...}` are reachable
without authentication. The full set lives in one array, `PUBLIC_ROUTES` in
`lib/auth/public-routes.ts`, read by `AuthGuard`, `AuthProvider`, and `proxy.ts`. It used to be
three hand-maintained copies that had already drifted — both password-reset pages were missing
from all three, so the one page an unauthenticated user needed in order to recover their account
redirected them straight back to the login page. If you add a page under `app/auth/`, a test
asserts every such directory is covered by this list, so a missing entry fails CI instead of
surfacing as a redirect loop in production.

`AuthProvider` actually matches a derived list, `SESSION_FETCH_SKIPPED_ROUTES` — the same set
minus `/auth/verify`, which needs its session resolved so the page can act on it.

## Related

- [multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md) — what a principal turns into
  once it's resolved, and how API key scopes are enforced
- [rate-limiting-and-account-security.md](rate-limiting-and-account-security.md) — login/register
  throttling, lockout, email verification, password reset
