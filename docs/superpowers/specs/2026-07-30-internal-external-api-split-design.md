# Internal/External API Split — InboxUI Design Spec

**Date**: 2026-07-30
**Status**: APPROVED
**Supersedes**: nothing. **Completes**: `2026-05-17-company-api-access-design.md` (§9 shared service layer, §11 drift-control rules)

**Scope**: Split the API into a browser-facing JWT tree (`/api/app/*`), an external API-key read-only tree (`/api/v1/*`), and an unauthenticated provider-ingest namespace (`/api/webhooks/*`). Introduce the shared service layer the 2026-05-17 spec specified but was never built, and fix the security defects that its absence produced.

---

## 1. Why now

The 2026-05-17 spec was approved and partially implemented. What shipped:

- `AuthContext` / `UserPrincipal` / `ApiKeyPrincipal` (`lib/auth/auth-context.ts`)
- `requireOrgAccess`, `requireScope` (`lib/auth/authorization.ts`)
- SHA-256 hashed API keys with one-time display, revocation and expiry in the lookup

What did not ship:

- **§9 shared service layer** — route handlers still call Prisma directly
- **§9D DTO/serializer layer** — only `serializeApiKey` exists
- **§11 drift-control rules** — never mechanized, enforced only by convention
- **§1 "write operations out of scope for v1"** — drifted; API keys can currently mutate

`requireInboxAccess` and `requireMessageAccess` were written but are **called by nothing outside their own test file**. Each route re-implements the gate by hand instead. That is the direct cause of the defects in §6: the scope check on the message `PATCH` drifted to `messages:read` because no shared code owned it.

The lesson driving this design: the 2026-05-17 rules were correct and did not hold, because nothing enforced them. This spec enforces the same rules with types and tests.

---

## 2. Decisions

| Decision | Choice |
|---|---|
| Structure | Two route trees over a shared service layer |
| Browser-facing tree | `/api/app/*`, unversioned |
| External tree | `/api/v1/*`, API key, strictly read-only |
| External resource naming | Keep `emailInbox` (not `inboxes`) — `phoneInbox`/SMS is coming and `inboxes` would be ambiguous |
| Migration | All JWT-only routes move in one pass |
| Visibility boundary | Organization-scoped for both principals |
| Security defects | Fixed as part of this work, not deferred |
| Live external consumers | None — external URLs may change freely |

---

## 3. Route topology

### 3.1 External — `/api/v1/*`

API key only, read-only. Four handlers. **No URL changes** from today; the two mutations are removed.

| Path | Method | Scope | Change |
|---|---|---|---|
| `/api/v1/emailInbox` | GET | `inboxes:read` | unchanged |
| `/api/v1/emailInbox/{id}` | GET | `inboxes:read` | newly key-reachable (JWT-only today) |
| `/api/v1/emailInbox/{id}/messages` | GET | `messages:read` | unchanged |
| `/api/v1/emailInbox/{id}/messages/{messageId}` | GET | `messages:read` | unchanged |

`PATCH` and `DELETE` on `…/messages/{messageId}` are **removed** from this tree and exist only under `/api/app/*`.

Messages stay nested under `emailInbox` rather than flattening to `/api/v1/messages/{id}`, so SMS messages have a non-colliding home later.

### 3.2 App — `/api/app/*`

JWT only, unversioned — it ships with the dashboard and has no external compatibility obligation.

| New | Was |
|---|---|
| `/api/app/auth/{login,register,me}` | `/api/auth/*` |
| `/api/app/account/{password,organization}` | `/api/v1/account/*` |
| `/api/app/apiKeys`, `/api/app/apiKeys/{id}` | `/api/v1/apiKeys/*` |
| `/api/app/stats` | `/api/v1/stats` |
| `/api/app/emailInbox/**` (incl. `otp`, `send`, message `PATCH`/`DELETE`) | `/api/v1/emailInbox/**` |
| `/api/app/phoneInbox/**` | `/api/v1/phoneInbox/**` |
| `/api/app/automations/**` | `/api/v1/automations/**` |
| `/api/app/webhooks/**` (management CRUD) | `/api/webhooks/**` |

`login` and `register` remain public — they are unauthenticated by nature and simply live in this tree.

### 3.3 Ingest — `/api/webhooks/*`

Unauthenticated at the wrapper level. Each handler verifies its provider's signature internally. Reserved exclusively for provider callbacks.

| Path | Verification |
|---|---|
| `POST /api/webhooks/email` | Svix/HMAC via `getResend().webhooks.verify()` — was `/api/v1/webhooks/email` |
| `POST /api/webhooks/sms` | Future release, same pattern |

Nothing else belongs here. Webhook *management* is a dashboard concern and lives at `/api/app/webhooks/*` behind `withUser`.

### 3.4 Unchanged

`/api/healthz`, `/api/internal/webhook-worker/health`, `/api/cron/sweep-stuck-runs`, `/api/docs`.

`/api/internal/*` is reserved for genuinely cluster-internal ops. This is why the browser-facing tree is `/api/app/*` and not `/api/internal/*`: the dashboard API is called *from the browser*, so an edge rule blocking `/api/internal` from the internet must stay safe to apply.

### 3.5 Ingest path migration

Moving `/api/v1/webhooks/email` → `/api/webhooks/email` requires a change in the **Resend dashboard**. If missed, inbound mail stops silently. Two-step:

1. Land `/api/webhooks/email`; old path re-exports the same handler (named re-export only — see §9).
2. Update Resend config, `.env.example:35`, `deploy/README.md`.
3. Delete the old path in a follow-up PR.

---

## 4. Why route groups were rejected

`app/api/(internal)/…` was evaluated and rejected. Verified against this repo's Next 16.0.3 by building a scaffold:

- Route groups are **stripped from the URL**. `/api/(internal)/grouped/route` serves at `/api/grouped`; `/api/internal/grouped` 404s. No URL separation means no WAF rule, no CORS policy, and no directory-filtered OpenAPI generation.
- Worse: two groups declaring the same path **build silently** and one handler wins. Verified — `next build --webpack` succeeded with both `/api/(internal)/v1/dup/route` and `/api/(public)/v1/dup/route` mapped to `/api/v1/dup` in `app-path-routes-manifest.json`. Since both surfaces want `emailInbox`, a shadowed public handler would serve internal semantics to key holders with no build error.

Two literal trees give real URL separation and let the OpenAPI generator filter by directory.

---

## 5. Auth layer

### 5.1 Two wrappers, no fallback

`resolveAuthContext` is **deleted**. Replaced by:

```ts
// lib/auth/with-auth.ts — 'server-only'
export function withUser<P>(handler: PrincipalHandler<UserPrincipal, P>): RouteHandler<P>
export function withApiKey<P>(
  options: { scopes: readonly ApiKeyScope[] },
  handler: PrincipalHandler<ApiKeyPrincipal, P>,
): RouteHandler<P>
```

The principal is a separate argument rather than a mutated request, so `NextRequest` stays honest and the narrowed type is first-class. `P` carries route params so `[id]` routes keep their typing.

### 5.2 Credential discrimination

Discrimination happens on the `sk_live_` prefix **before any verification**:

- prefix present → API-key path only, never falls through to JWT
- prefix absent → JWT path only

Today `resolveAuthContext` tries `jwt.verify` first and falls back to an API-key hash lookup on the same `Bearer` value with no discriminator. Removing the fallback fixes three things:

1. **Credential confusion.** RFC 8725 §2.8 names this class ("Cross-JWT Confusion", a substitution attack). GitHub redesigned all its token formats around offline-determinable prefixes for the same reason.
2. **Misleading errors.** An expired JWT currently falls through to a key lookup and reports as a bad key.
3. **Availability coupling.** `getJwtSecret()` throws *outside* the try block in `verifyToken` (deliberately, `lib/auth-server.ts:44`). A misconfigured `JWT_SECRET` therefore 500s valid API-key traffic before the fallback is reached — the external API's availability currently depends on the internal API's secret.

Deferred: adding `typ`/`aud` claims to issued JWTs. Validating a new claim invalidates every active session, and the prefix check resolves the practical confusion. Follow-up, not this change.

### 5.3 Scopes

```ts
export const API_KEY_SCOPES = ['inboxes:read', 'messages:read'] as const
export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = ['inboxes:read', 'messages:read']
```

`messages:delete` retires. `DEFAULT_API_KEY_SCOPES` is **explicitly enumerated**, never `[...API_KEY_SCOPES]` — that spread is precisely how the current default came to grant delete. When a write scope is added later it must not become a default by accident.

**Data migration required**: strip `messages:delete` from the `scopes` array of every existing `ApiKey` row.

### 5.4 Authorization helpers

- `requireScope` loses its `kind === 'user'` short-circuit and becomes API-key-only. The short-circuit is only meaningful when both principals share a route.
- `requireOrgAccess` splits into user and key variants.
- `requireInboxAccess` and `requireMessageAccess` are **deleted** — dead code today, superseded by the service layer.

---

## 6. Service and serializer layer

### 6.1 The principal never reaches the service layer

```
withUser    → UserPrincipal   ─┐
                               ├→ toOrgScope() → { organizationIds } → service → serializer
withApiKey  → ApiKeyPrincipal ─┘
```

```ts
// lib/services/scope.ts
export type OrgScope = { organizationIds: string[] }
export function toOrgScope(p: UserPrincipal | ApiKeyPrincipal): OrgScope
```

A user's scope is their membership org IDs; a key's is a single-element array. Because both principals reduce to the same value, **services cannot branch on credential type — they never see one.** Every defect in §7 lives in a `context.kind` fork inside a handler; this makes those forks unrepresentable below the route layer.

This is 2026-05-17 §11 enforced by types instead of discipline.

```ts
// lib/services/email-inbox.ts — 'server-only'
listInboxes(scope: OrgScope, opts): Promise<EmailInbox[]>
getInbox(scope: OrgScope, id: string): Promise<EmailInbox | null>
listMessages(scope: OrgScope, inboxId: string, opts): Promise<PagedMessages>
getMessage(scope: OrgScope, inboxId: string, messageId: string): Promise<EmailMessage | null>
```

The grouped-thread cursor query in `app/api/v1/emailInbox/[id]/messages/grouped-query.ts` moves behind `listMessages` unchanged. Its `DATABASE_URL` timezone dependency (see CLAUDE.md) is unaffected.

### 6.2 Serializers

`lib/serializers/public/` holds hand-written field allowlists for the external surface — never a Prisma model spread, never a passthrough `select`. A new column cannot publish itself.

The app surface keeps richer shapes and evolves freely. Divergence between the two is the intent, not duplication to be refactored away. Public serializers get snapshot tests (§8).

---

## 7. Security defects fixed

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | Write gated by a read scope | `PATCH …/messages/{messageId}` requires `messages:read` | Removed from external tree; app-only |
| 2 | Destructive op reachable by any org key | `DELETE …/messages/{messageId}` | Removed from external tree; app-only |
| 3 | Permissive default scopes | `DEFAULT_API_KEY_SCOPES = [...API_KEY_SCOPES]` (`lib/api-key-scopes.ts:5`) — a key created without explicit scopes could delete | Explicit read-only enumeration + data migration |
| 4 | Credential confusion + availability coupling | `lib/auth/auth-context.ts:28-33` | `sk_live_` prefix discrimination, no fallback |
| 5 | Key sees more than its creator | `GET /api/v1/emailInbox` filters `{userId}` for JWT, `{organizationId}` for keys | Uniform org scoping via `OrgScope` |
| 6 | Dual resolver on user-only routes | `account/password`, `account/organization` call `resolveAuthContext` then 403 keys | Plain `withUser` |
| 7 | Inconsistent tenancy on sibling routes | `otp` is org-scoped; siblings are `userId`-scoped | Resolved by uniform org scoping |
| 8 | Wrong-org writes | The webhook create route (`POST /api/webhooks` today, `POST /api/app/webhooks` after the move) always writes `user.memberships[0].organizationId`, ignoring any caller-supplied org | Require explicit `organizationId` + membership check, matching every other create route |

### 7.1 Accepted consequences

- **Org-scoped visibility changes dashboard behavior.** Members now see each other's inboxes within an organization. This is the boundary 2026-05-17 §6 specified: *"The new boundary should be organization + scope."*
- **Any org member can delete a teammate's inbox.** `Membership.role` exists but is unused for authorization. Role-gating is deliberately **out of scope** here and tracked as a follow-up.
- **`GET /api/v1/emailInbox/{id}` becomes key-reachable.** Deliberate — it completes the external read surface.

---

## 8. Testing and enforcement

The invariants below are the mechanism that failed in 2026-05-17. They become tests, not conventions.

**Structural guards** (walk the route tree, assert on exports):

1. No `POST`/`PUT`/`PATCH`/`DELETE` export anywhere under `app/api/v1/**` — the read-only invariant
2. Every route under `app/api/v1/**` uses `withApiKey`
3. Every route under `app/api/app/**` uses `withUser`
4. Every path in the served OpenAPI spec starts with `/api/v1`

**Behavioral tests:**

5. `withApiKey` rejects a valid JWT; `withUser` rejects a valid API key
6. Cross-org access denied for both principal kinds
7. Missing scope → 403; revoked or expired key → 401
8. Snapshot tests on every public serializer — a field appearing or disappearing fails the build

**Regression:**

9. Full suite green (`npm run test`, 334+ tests). Test count must not decrease.
10. Integration suite (`npm run test:integration`) against real Postgres.

---

## 9. Migration mechanics

### 9.1 Client blast radius

No UI component calls `apiClient` directly — every request funnels through nine wrappers. That is the entire client-side surface:

- `lib/api/{emails,automations,webhooks,api-keys,phones,auth,account,stats}.api.ts`
- `lib/api-client.ts` — the `/api` base
- 5 MSW `BASE` constants in `test/mocks/handlers/`
- 4 test files with hardcoded absolute URLs in `server.use()` overrides: `app/settings/__tests__/settings.test.tsx:50`, `app/api-keys/__tests__/page.test.tsx:43`, `components/__tests__/phones-list.test.tsx:30`, `components/__tests__/emails-list.test.tsx:33`

`lib/api/webhooks.api.ts` and several wrappers are dead (the webhooks page renders hardcoded mock data). Dead wrappers move with the rest; removing them is out of scope.

### 9.2 Handler sharing constraints

Verified against Next 16.0.3:

- **Named re-exports only** (`export { GET } from '…'`). `export *` breaks the generated route-export validator. Note `next.config.mjs` sets `typescript.ignoreBuildErrors: true`, so this fails silently here — enforce by review.
- **Route segment config cannot be re-exported.** `runtime`, `maxDuration`, `preferredRegion` are read by build-time AST analysis that only matches a literal `export const X` in the route file itself. A re-export is skipped with no diagnostic. Keep any segment config inline in each `route.ts`.

### 9.3 proxy.ts

`proxy.ts` already excludes `/api` from its matcher and stays that way. In Next 16 it is Node-runtime-only and the docs are explicit that it should not be the only line of defense; a DB lookup for API-key validation there would put a round-trip on every matched request. All enforcement stays per-route.

*Open item*: confirm `proxy.ts` is actually registered — Next 16 expects the `proxy` export convention, and it may be inert today. This does not block the split (no auth depends on it) but should be verified.

### 9.4 Docs to update

`lib/openapi/email-inboxes.ts` — path keys embed `/api`; drop the `PATCH`/`DELETE` operations on `…/messages/{messageId}` and add `GET /api/v1/emailInbox/{id}`.

`lib/openapi/api-keys.ts` — **delete**. It documents `/api/v1/apiKeys/*` as public, but API key management is an app concern and those routes move to `/api/app/*`. It is imported by nothing and served by nothing today, so deleting it removes a spec that could only ever document the wrong thing.

Also: `CLAUDE.md`, `deploy/README.md`, `deploy/runbooks/*`, `.env.example:35`.

---

## 10. Out of scope

- Rate limiting on the external surface (table stakes for a public API; tracked separately, see `2026-06-06-rate-limiting-and-entitlements-design.md`)
- Machine-readable error `code` field in `jsonError`
- `Deprecation`/`Sunset` headers and a published compatibility policy
- Role-based authorization using `Membership.role`
- `typ`/`aud` JWT claims
- Automated OpenAPI generation (spec stays hand-written; §8 guard 4 covers leakage)
- Removing dead client wrappers and dead route handlers
- CORS on the external surface — deliberately absent and should stay absent; secret keys are server-to-server

---

## 11. Success criteria

- `/api/v1/*` contains exactly four GET handlers, all `withApiKey`, all read-only, enforced by test
- `/api/app/*` contains every JWT route, all `withUser`, enforced by test
- `/api/webhooks/*` contains only provider ingest with in-handler signature verification
- `resolveAuthContext` no longer exists; no route accepts both credential types
- No service-layer function receives a principal or branches on credential kind
- All eight defects in §7 fixed with a test each
- Full suite green; test count not decreased
