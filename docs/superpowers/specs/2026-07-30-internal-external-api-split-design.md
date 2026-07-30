# Internal/External API Split — InboxUI Design Spec

**Date**: 2026-07-30
**Revision**: 4 (see §12)
**Status**: AWAITING APPROVAL
**Completes**: `2026-05-17-company-api-access-design.md` (§9 shared service layer, §11 drift-control rules)

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

`requireInboxAccess` and `requireMessageAccess` were written but are **called by nothing outside their own test file**. Each route re-implements the gate by hand instead. That is the direct cause of the defects in §7: the scope check on the message `PATCH` drifted to `messages:read` because no shared code owned it.

The lesson driving this design: the 2026-05-17 rules were correct and did not hold, because nothing enforced them. This spec enforces the same rules with types and tests.

---

## 2. Decisions

| Decision | Choice |
|---|---|
| Structure | Two route trees over a shared service layer |
| Browser-facing tree | `/api/app/*`, unversioned |
| External tree | `/api/v1/*`, API key, strictly read-only |
| External resource naming | Keep `emailInbox` (not `inboxes`) — `phoneInbox`/SMS is coming and `inboxes` would be ambiguous |
| Migration | All JWT-only routes move in one pass, after a prerequisite ingest PR (§3.5) |
| **Read visibility** | **Organization-scoped for both principals** |
| **Mutation authority** | **Creator-scoped (`userId`) — unchanged from today** |
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

`login` and `register` remain public. They are wrapped in `withPublic` (§5.1) rather than left bare, so "deliberately unauthenticated" is a visible decision at the route and the structural guards can still assert that every handler in the tree was classified.

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

### 3.5 Ingest migration is a prerequisite PR, not part of the split

Moving `/api/v1/webhooks/email` → `/api/webhooks/email` requires a change in the **Resend dashboard**. If missed, inbound mail stops silently, so the old path must stay alive across the cutover.

That alias is a `POST` under `app/api/v1/**`, which the read-only guard (§8 guard 1) forbids. The two cannot coexist. Sequencing resolves it:

- **PR 0 — ingest move.** Add `/api/webhooks/email`; old path re-exports the handler (named re-export only, §9.2). Update Resend config, `.env.example:35`, `deploy/README.md`. Verify inbound mail on the new path in production.
- **PR 0b — remove the alias.** Delete `/api/v1/webhooks/email` once the new path is confirmed live.
- **PR 1+ — the split.** The read-only guard lands here, against a `/api/v1` tree that already contains no mutations.

The guard is therefore never written against a tree that violates it, and never needs an exception. Guards with exceptions invite more exceptions.

---

## 4. Why route groups were rejected

`app/api/(internal)/…` was evaluated and rejected. Verified against this repo's Next 16.0.3 by building a scaffold:

- Route groups are **stripped from the URL**. `/api/(internal)/grouped/route` serves at `/api/grouped`; `/api/internal/grouped` 404s. No URL separation means no WAF rule, no CORS policy, and no directory-filtered OpenAPI generation.
- Worse: two groups declaring the same path **build silently** and one handler wins. Verified — `next build --webpack` succeeded with both `/api/(internal)/v1/dup/route` and `/api/(public)/v1/dup/route` mapped to `/api/v1/dup` in `app-path-routes-manifest.json`. Since both surfaces want `emailInbox`, a shadowed public handler would serve internal semantics to key holders with no build error.

Two literal trees give real URL separation and let the OpenAPI generator filter by directory.

---

## 5. Auth layer

### 5.1 Three wrappers, no fallback

`resolveAuthContext` is **deleted**. Replaced by:

```ts
// lib/auth/with-auth.ts — 'server-only'
export function withUser<P>(handler: PrincipalHandler<UserPrincipal, P>): RouteHandler<P>
export function withApiKey<P>(
  options: { scopes: readonly ApiKeyScope[] },
  handler: PrincipalHandler<ApiKeyPrincipal, P>,
): RouteHandler<P>
export function withPublic<P>(handler: RouteHandler<P>): RouteHandler<P>
```

The principal is a separate argument rather than a mutated request, so `NextRequest` stays honest and the narrowed type is first-class. `P` carries route params so `[id]` routes keep their typing.

`withPublic` performs no authentication — it exists solely to tag a handler as *deliberately* unauthenticated. Without it, "this route has no auth wrapper" is indistinguishable from "someone forgot the auth wrapper", and guard 5 (§8.1) could not tell them apart. It applies to `login`, `register`, and the `/api/webhooks/*` ingest handlers, which verify provider signatures internally.

All three wrappers tag the function they return with a distinct non-enumerable symbol (§8.1), which is what makes the structural guards trustworthy.

### 5.2 Credential discrimination

Discrimination happens on the API key prefix **before any verification**:

- prefix matches `API_KEY_PREFIX` → API-key path only, never falls through to JWT
- otherwise → JWT path only

`API_KEY_PREFIX` (`'sk_live_'`) is a shared exported constant, not an inline literal, so adding `sk_test_` later is a single-site change. An unrecognised prefix fails closed.

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

A key whose scopes were *only* `['messages:delete']` would be left with an empty array — it would still authenticate but authorize nothing, failing every request with a 403 that reads like a configuration error. Such keys are **backfilled to `['inboxes:read', 'messages:read']`** rather than emptied. This is a narrowing in every case (delete is being removed regardless) and it fails visibly rather than silently. The migration must report how many rows it touched in each category.

**Check before landing**: the dashboard key-creation form must not submit `messages:delete`, or creation will 400 against the narrowed `API_KEY_SCOPE_SET`.

### 5.4 Authorization helpers

- `requireScope` loses its `kind === 'user'` short-circuit and becomes API-key-only. The short-circuit is only meaningful when both principals share a route.
- `requireOrgAccess` is absorbed into `toOrgScope` (§6.2).
- `requireInboxAccess` and `requireMessageAccess` are **deleted** — dead code today, superseded by the service layer. Their existing tests are replaced by service-layer tests covering the same cases, so coverage does not decrease.

---

## 6. Service and serializer layer

### 6.1 Two scope types, not one

Reads are organization-wide; mutations remain creator-only (§2). Those are different authorities, so they are different types:

```ts
// lib/services/scope.ts
export type OrgScope   = { organizationIds: string[] }   // who can SEE this
export type OwnerScope = { userId: string }              // who can CHANGE this
```

```
withUser    → UserPrincipal   ─┬→ toOrgScope()   → OrgScope   → read services
                               └→ toOwnerScope() → OwnerScope → mutation services
withApiKey  → ApiKeyPrincipal ──→ toOrgScope()   → OrgScope   → read services
```

**`toOwnerScope` accepts only a `UserPrincipal`.** An `ApiKeyPrincipal` cannot be converted, so no API key can reach a mutating service — enforced by the compiler, independently of which tree the route lives in. This is a second, type-level line of defense behind the §8 structural guards.

Because both principals reduce to the same `OrgScope` for reads, **read services cannot branch on credential type — they never see one.** Every defect in §7 lives in a `context.kind` fork inside a handler; this makes those forks unrepresentable below the route layer.

This is 2026-05-17 §11 enforced by types instead of discipline.

### 6.2 `toOrgScope` owns the membership check

A user belongs to many organizations, so any route that narrows to one (`?organizationId=X`) must verify membership. If that check lives in routes, every route re-implements it — the exact failure mode this design exists to remove. It lives in the conversion instead:

```ts
export function toOrgScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string,
): { scope: OrgScope; error?: never } | { scope?: never; error: Response }
```

- **User, no request** → every organization they are a member of
- **User, requested** → single-element scope, or `403` if not a member
- **Key, no request** → the key's bound organization
- **Key, requested** → single-element scope, or `403` if it isn't the bound organization

There is no way to construct an `OrgScope` that skips this check, because the type is only produced here.

### 6.3 Service surface

```ts
// lib/services/email-inbox.ts — 'server-only'
listInboxes(scope: OrgScope, opts): Promise<EmailInbox[]>
getInbox(scope: OrgScope, id: string): Promise<EmailInbox | null>
listMessages(scope: OrgScope, inboxId: string, opts): Promise<PagedMessages>
getMessage(scope: OrgScope, inboxId: string, messageId: string): Promise<EmailMessage | null>

updateInbox(owner: OwnerScope, id: string, data): Promise<EmailInbox>
deleteInbox(owner: OwnerScope, id: string): Promise<void>
setMessageStarred(owner: OwnerScope, inboxId: string, messageId: string, starred: boolean)
deleteMessage(owner: OwnerScope, inboxId: string, messageId: string): Promise<void>
```

The grouped-thread cursor query in `app/api/v1/emailInbox/[id]/messages/grouped-query.ts` moves behind `listMessages` unchanged. Its `DATABASE_URL` timezone dependency (see CLAUDE.md) is unaffected.

### 6.4 Serializers

`lib/serializers/public/` holds hand-written field allowlists for the external surface — never a Prisma model spread, never a passthrough `select`. A new column cannot publish itself.

The app surface keeps richer shapes and evolves freely. Divergence between the two is the intent, not duplication to be refactored away. Public serializers get snapshot tests (§8.2).

### 6.5 `isOwner` on the app surface

The split authority model (org-wide reads, creator-only mutations) has a UI consequence: a user now sees inboxes in the list that they cannot rename, delete, or send from. `components/emails-list.tsx` currently renders delete actions unconditionally, so without a change every user would meet buttons that always fail.

The **app** serializer therefore returns a derived `isOwner: boolean` (`inbox.userId === principal.userId`), and the UI hides or disables owner-only actions when it is false. The raw `userId` is not exposed — `isOwner` answers the question the UI actually has without publishing another user's identifier.

This field is **app-only**. The external serializer is unaffected: an API key has no meaningful "owner" relative to an inbox, and the external surface is read-only, so the concept does not arise there.

---

## 7. Security defects fixed

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | Write gated by a read scope | `PATCH …/messages/{messageId}` requires `messages:read` | Removed from external tree; app-only |
| 2 | Destructive op reachable by any org key | `DELETE …/messages/{messageId}` | Removed from external tree; app-only |
| 3 | Permissive default scopes | `DEFAULT_API_KEY_SCOPES = [...API_KEY_SCOPES]` (`lib/api-key-scopes.ts:5`) — a key created without explicit scopes could delete | Explicit read-only enumeration + data migration |
| 4 | Credential confusion + availability coupling | `lib/auth/auth-context.ts:28-33` | Prefix discrimination, no fallback |
| 5 | Key sees more than its creator | `GET /api/v1/emailInbox` filters `{userId}` for JWT, `{organizationId}` for keys | Uniform `OrgScope` for all reads |
| 6 | Dual resolver on user-only routes | `account/password`, `account/organization` call `resolveAuthContext` then 403 keys | Plain `withUser` |
| 7 | Inconsistent tenancy on sibling routes | `otp` is org-scoped; siblings are `userId`-scoped | Uniform `OrgScope` (read) |
| 8 | Wrong-org writes | The webhook create route always writes `user.memberships[0].organizationId`, ignoring any caller-supplied org | Require explicit `organizationId` + membership check via `toOrgScope` |

### 7.1 Accepted consequences

**Read visibility widens.** Members now see each other's inboxes and messages within an organization. This is the boundary 2026-05-17 §6 specified: *"The new boundary should be organization + scope."* It is still a visibility change for existing orgs where members created inboxes expecting them to be private, and should be communicated in release notes rather than shipped silently.

**Mutation authority does not widen.** Rename, delete, send and star remain restricted to the inbox creator. This is deliberate. Full org-scoping of mutations would let any member delete any inbox — which soft-deletes the inbox *and cascades to all its messages* in one transaction, and per the `F1` comment in `[id]/route.ts:84` deliberately retains the row so **the address can never be reclaimed**. One careless member could permanently burn an organization's email addresses. Role-based mutation authority using `Membership.role` is the correct long-term answer and is tracked as a follow-up (§10); until then, creator-scoping is the safe default.

**`GET /api/v1/emailInbox/{id}` becomes key-reachable.** Deliberate — it completes the external read surface.

---

## 8. Testing and enforcement

The invariants below are the mechanism that failed in 2026-05-17. They become tests, not conventions.

### 8.1 Structural guards

Text- or AST-matching on route source is not trustworthy for a security invariant: a grep passes on a comment, and an AST check is brittle across refactors. Instead, **each wrapper attaches a distinct non-enumerable symbol to the handler it returns.** The guard imports every route module and inspects the exported handlers directly.

1. No `POST`/`PUT`/`PATCH`/`DELETE` export anywhere under `app/api/v1/**` — the read-only invariant
2. Every exported handler under `app/api/v1/**` carries the `withApiKey` tag
3. Every exported handler under `app/api/app/**` carries the `withUser` tag, **except** `auth/login` and `auth/register`, which must carry the `withPublic` tag
4. Every exported handler under `app/api/webhooks/**` carries the `withPublic` tag
5. **Every exported handler in all three trees carries exactly one of the three tags** — an untagged handler fails, which is the case guards 2–4 would otherwise miss entirely
6. Every path in the served OpenAPI spec starts with `/api/v1`

Guards 2–5 cannot be satisfied by a comment and survive renaming or re-ordering. Guard 5 is the load-bearing one: it converts "someone forgot the wrapper" from an invisible omission into a failing test, which is why `withPublic` exists rather than an allowlist of bare routes.

### 8.2 Behavioral tests

6. `withApiKey` rejects a valid JWT; `withUser` rejects a valid API key
7. `toOrgScope` returns 403 for a non-member requested org, for both principal kinds
8. `toOwnerScope` does not accept an `ApiKeyPrincipal`
9. Mutation services reject a non-creator
10. Missing scope → 403; revoked or expired key → 401
11. Snapshot tests on every public serializer — a field appearing or disappearing fails the build
12. App serializer sets `isOwner` true only for the creating user

Test 8 is a *type-level* guarantee, and this repo does not typecheck in CI: `next.config.mjs` sets `typescript.ignoreBuildErrors: true`, Vitest does not typecheck by default, and CLAUDE.md documents pre-existing TS errors in `app/phones/*` that would make a bare `tsc --noEmit` gate fail on unrelated code. So the compiler protects a developer in an editor but proves nothing in CI unless this is closed. Two options, in preference order:

1. Enable `vitest --typecheck` scoped to `**/*.test-d.ts`, so type assertions run as real tests without gating on the repo's pre-existing errors.
2. If that proves awkward, add a **runtime** assertion in `toOwnerScope` that throws on a non-`user` principal, and test that instead. Weaker (it fails at request time rather than build time) but genuinely enforced.

Do not leave test 8 as a compile-time claim with no CI backing — that is a guarantee in name only.

### 8.3 Regression

12. Full suite green (`npm run test`, 334+ tests). Test count must not decrease — helper tests deleted in §5.4 are replaced by equivalent service-layer tests.
13. Integration suite (`npm run test:integration`) against real Postgres.

---

## 9. Migration mechanics

### 9.1 Deploy skew — no mitigation needed

Every dashboard path changes at once, so a browser holding pre-deploy JS would call `/api/v1/emailInbox`, receive **404 rather than 401**, and break silently — `lib/api-client.ts` only treats 401 as a session signal.

**There are no users, so there are no in-flight browsers.** No mitigation is built.

This is also the cleanest outcome for the invariants: the alternative — aliasing old app paths for one release — was never available anyway, because those paths are `/api/v1/emailInbox` (POST), `/api/v1/apiKeys` (POST/DELETE) and so on, which guard 1 forbids. Doing nothing keeps guard 1 absolute with no window and no exception.

Revisit before the first real users: once the dashboard has a live audience, a path change of this size needs either aliases (incompatible with guard 1) or 404-as-version-skew handling in `api-client.ts`. Neither is worth building now.

### 9.2 Client blast radius

No UI component calls `apiClient` directly — every request funnels through nine wrappers. That is the entire client-side surface:

- `lib/api/{emails,automations,webhooks,api-keys,phones,auth,account,stats}.api.ts`
- `lib/api-client.ts` — the `/api` base
- 5 MSW `BASE` constants in `test/mocks/handlers/`
- 4 test files with hardcoded absolute URLs in `server.use()` overrides: `app/settings/__tests__/settings.test.tsx:50`, `app/api-keys/__tests__/page.test.tsx:43`, `components/__tests__/phones-list.test.tsx:30`, `components/__tests__/emails-list.test.tsx:33`

### 9.3 Handler sharing constraints

Verified against Next 16.0.3:

- **Named re-exports only** (`export { GET } from '…'`). `export *` breaks the generated route-export validator. Note `next.config.mjs` sets `typescript.ignoreBuildErrors: true`, so this fails silently here — enforce by review.
- **Route segment config cannot be re-exported.** `runtime`, `maxDuration`, `preferredRegion` are read by build-time AST analysis that only matches a literal `export const X` in the route file itself. A re-export is skipped with no diagnostic. Keep any segment config inline in each `route.ts`.

Both constraints apply to the §3.5 ingest alias, which is the only alias in this design.

### 9.4 proxy.ts

`proxy.ts` already excludes `/api` from its matcher and stays that way. In Next 16 it is Node-runtime-only and the docs are explicit that it should not be the only line of defense; a DB lookup for API-key validation there would put a round-trip on every matched request. All enforcement stays per-route.

*Open item*: confirm `proxy.ts` is actually registered — Next 16 expects the `proxy` export convention, and it may be inert today. This does not block the split (no auth depends on it) but should be verified.

### 9.5 Docs to update

`lib/openapi/email-inboxes.ts` — path keys embed `/api`; drop the `PATCH`/`DELETE` operations on `…/messages/{messageId}` and add `GET /api/v1/emailInbox/{id}`.

`lib/openapi/api-keys.ts` — **delete**. It documents `/api/v1/apiKeys/*` as public, but API key management is an app concern and those routes move to `/api/app/*`. It is imported by nothing and served by nothing today, so deleting it removes a spec that could only ever document the wrong thing.

Also: `CLAUDE.md`, `deploy/README.md`, `deploy/runbooks/*`, `.env.example:35`.

---

## 10. Out of scope

Deferred deliberately. The first three carry stated risk rather than being neutral omissions.

- **Rate limiting on the external surface.** Nothing exists today outside `lib/automations/replay-rate-limit.ts`. This leaves an authenticated but unthrottled read API over **message content** — the highest-value data in the system — where a single leaked key can be used to bulk-exfiltrate an organization's mail at whatever rate the database sustains. Cursor pagination bounds page size, not request rate. Tracked in `2026-06-06-rate-limiting-and-entitlements-design.md`; this should be the next piece of work after the split, not an indefinite backlog item.
- **Contract tests binding the OpenAPI spec to actual responses.** 2026-05-17 §12C required these; this spec does not restore them. Guard 5 checks only that documented paths start with `/api/v1`, and serializer snapshots (§8.2 #11) catch drift in code but not divergence between code and published docs. A hand-written spec can still omit an endpoint or misdescribe a response shape.
- **Public serializer field lists are decided at implementation time**, not fixed here. For a design whose purpose is contract stability, the field allowlist arguably belongs in the spec; it is deferred to keep this revision focused, and should be reviewed explicitly at implementation.
- Machine-readable error `code` field in `jsonError`
- `Deprecation`/`Sunset` headers and a published compatibility policy
- Role-based mutation authority using `Membership.role` (see §7.1)
- `typ`/`aud` JWT claims
- Automated OpenAPI generation
- Removing dead client wrappers and dead route handlers — `lib/api/webhooks.api.ts` is entirely dead and the webhooks page renders hardcoded mock data. Migration is the cheapest moment to delete this; deferring means paying to relocate known-dead code.
- CORS on the external surface — deliberately absent and should stay absent; secret keys are server-to-server

---

## 11. Success criteria

- `/api/v1/*` contains exactly four GET handlers, all tagged `withApiKey`, all read-only
- `/api/app/*` contains every JWT route tagged `withUser`, with `login`/`register` tagged `withPublic`
- `/api/webhooks/*` contains only provider ingest, tagged `withPublic`, with in-handler signature verification
- **Every handler in all three trees carries exactly one tag** — no untagged route exists (guard 5)
- `resolveAuthContext` no longer exists; no route accepts both credential types
- No read service receives a principal or branches on credential kind
- No API key can reach a mutating service — enforced by `toOwnerScope`, with CI backing per §8.2
- Every narrowing to a specific organization passes through `toOrgScope`'s membership check
- All eight defects in §7 fixed with a test each
- No mutation exists under `/api/v1` at any point in the migration, including intermediate states
- Owner-only actions are hidden in the UI for non-owners (`isOwner`, §6.5)
- Full suite green; test count not decreased

---

## 12. Revision history

**Revision 4 (2026-07-30)** — scope reduction:

1. **Deploy-skew mitigation removed (§9.1).** There are no users yet, so there are no in-flight browsers to protect. Revision 3 specified a 404-as-version-skew reload in `api-client.ts`; that is now unbuilt and flagged to revisit before the first real audience. Guard 1 is unaffected — it stays absolute either way, since the aliases that would have violated it were already ruled out.

The §3.5 ingest sequencing stays as-is. It is not a user-facing safety measure: it exists so guard 1 never needs an exception, which holds regardless of how many users exist. The Resend dashboard config is also live infrastructure independent of app traffic.


**Revision 3 (2026-07-30)** — after re-review of revision 2, which found that two of its own fixes introduced new contradictions:

1. **Compatibility aliases removed (§9.1).** Revision 2 fixed the ingest contradiction by sequencing, then reintroduced the identical contradiction for the app migration: the old app paths *are* `/api/v1/**` mutations, which guard 1 forbids. Guard 1 has no windows and no exceptions. (Revision 3 replaced the aliases with client-side skew handling; revision 4 dropped that too — see above.)
2. **`withPublic` wrapper added (§5.1, §8.1).** Revision 2's guard 3 required every `/api/app/**` handler to be `withUser`-tagged while §3.2 kept `login`/`register` public — contradictory. Tagging public routes explicitly also enables the new guard 5, which catches a handler with no wrapper at all. That case was previously invisible to every guard.
3. **Type-level guarantee given CI backing (§8.2).** Revision 2 asserted `toOwnerScope`'s signature as a compile-time test, but this repo does not typecheck in CI (`ignoreBuildErrors: true`, no Vitest typecheck, pre-existing errors in `app/phones/*`). Now specifies `vitest --typecheck` or a runtime fallback.
4. **`isOwner` added to the app serializer (§6.5).** Neither prior revision addressed the UI consequence of org-wide reads with creator-only mutations: users would see delete buttons on inboxes they cannot delete.
5. **Scope migration cannot brick keys (§5.3).** A key scoped only to `messages:delete` would have been left with an empty array — authenticating but authorizing nothing. Such keys are backfilled to read scopes.

**Implementation-ordering rule derived from this review:** the structural guards (§8.1) are written **first**, and the topology is made to satisfy them. Both revision 2 defects were invariants asserted in one section and violated in another — a class of error that a passing guard catches immediately and a careful re-read does not.


**Revision 2 (2026-07-30)** — after critical security and maintenance review of revision 1:

1. **Ingest move promoted to a prerequisite PR (§3.5).** Revision 1 kept `/api/v1/webhooks/email` aliased during the Resend cutover while also asserting no mutations exist under `app/api/v1/**`. Those were contradictory. Sequencing removes the contradiction without giving the guard an exception.
2. **Mutations stay creator-scoped (§2, §6.1, §7.1).** Revision 1 made everything organization-scoped, which would have let any member permanently destroy an inbox and burn its address. Reads widen; mutation authority does not.
3. **`toOrgScope` owns the membership check (§6.2).** Revision 1 left narrowing to a requested `organizationId` unspecified, so each route would have re-implemented it — the failure mode this design exists to remove.
4. **Structural guards use symbol tags, not source matching (§8.1).** Revision 1's guards would have passed on a comment mentioning the wrapper name. Added guard 4 to catch an entirely unwrapped handler.
5. **Compatibility aliases for one release (§9.1).** Revision 1's big-bang path change would have 404'd in-flight browsers, which `api-client.ts` does not handle — only 401 triggers its redirect.
6. **Stated risk on deferred items (§10).** Rate limiting, contract tests and the unfixed serializer field list were listed as neutral non-goals in revision 1; they carry real exposure and now say so.
7. Minor: `API_KEY_PREFIX` as a shared constant (§5.2); dashboard scope-form check before narrowing `API_KEY_SCOPE_SET` (§5.3); deleted helper tests replaced rather than dropped (§5.4).
