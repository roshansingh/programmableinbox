# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🔒 Git Worktree Requirement

**ALL agentic coding (agents writing code) MUST use git worktrees.**

- **For you**: Before dispatching agents to write code, ensure they use `superpowers:using-git-worktrees` to create an isolated worktree
- **For agents**: Always start by creating a git worktree. Never code on main/master or shared branches
- **Workflow**: Create worktree → implement → test → finish with `superpowers:finishing-a-development-branch` (merge, PR, or keep)

This prevents concurrent work from interfering and keeps the git history clean.

## ✅ Pre-PR Testing Requirement

**ALWAYS run the full test suite before creating a PR.**

```bash
npm run test  # Must pass all tests before PR creation
```

- **Full suite**: `npm run test` — runs all tests across all test projects (UI, Node, etc.)
- **Specific suite**: `npm run test -- lib/commercial` — test a specific directory
- **Watch mode**: `npm run test:watch` — for development iteration

**PR criteria**:
- ✅ All tests passing (334+ tests in suite)
- ✅ No unexpected test failures introduced
- ✅ Test count should not decrease unless tests are intentionally removed

This prevents broken code from reaching review and saves iteration time.

## Commands

```bash
npm run dev          # Next.js dev server on Turbopack (port 4000)
npm run build        # Production build via Webpack (see Build System below)
npm run start        # Production server (port 4000)
npm run lint         # ESLint
npm run test         # Vitest (run once, runs all test projects)
npm run test:watch   # Vitest watch mode
npx vitest run --project ui components/__tests__/emails-list.test.tsx   # Single UI test file
npx vitest run --project node lib/__tests__/logger.test.ts              # Single Node test file
npx prisma migrate dev      # Apply migrations + regen client to lib/generated/prisma
npx prisma db seed          # Seed via prisma/seed.ts (creates test@example.com / password123)
npm audit fix        # Fix non-breaking security vulnerabilities
```

`repo-info.md` exists but is gitignored and stale — don't trust it.

## Build System

- **Dev**: Turbopack for fast iteration (`npm run dev`)
- **Prod**: Webpack for stability (`npm run build --webpack`), configured to mark `thread-stream` as external
- **Reason**: Pino's thread-stream dependency includes non-code artifacts (shell scripts, test files, LICENSE) that Turbopack cannot parse; webpack handles this via externals configuration

## Logging

Production-ready structured logging via **Pino v10** (`lib/logger.ts`):

- **API**: Direct method calls — `logger.error({ error }, 'message')` (not `logger().error()`)
- **Config**: `lib/logger.config.ts` returns dev config (colorized via pino-pretty) or prod (JSON for log aggregators)
- **Environment**: `LOG_LEVEL` env var (valid: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`); unset means `debug` (dev) or `info` (prod). An *invalid* value is rejected by `lib/config` rather than warned about and ignored
- **Error serialization**: Both `err` and `error` keys use Pino's error serializer for consistent stack traces
- **Singleton**: Lazy-loaded via Proxy pattern in `lib/logger.ts` — module load has zero overhead
- **Route instrumentation**: API routes use `logger.error({ error }, 'message')` on failures; use `logger.info()` for success logging with context

## Configuration (`lib/config/`)

**`lib/config/` is the only place `process.env` is read.** An ESLint rule and `lib/config/__tests__/no-raw-env.test.ts` both enforce that; the allowlist is `lib/config/**`, `prisma.config.ts`, `prisma/seed.ts`, `next.config.mjs`, `instrumentation.ts`, the vitest configs, and test files. `prisma.config.ts` and `prisma/seed.ts` are exempt because they run outside Next, under the Prisma CLI and `tsx`, and must not pull in `server-only` or the app's module graph.

| File | Role |
|---|---|
| `schema.ts` | One zod schema per domain, plus the `DOMAIN_SCHEMAS` registry. `vars` there is the authoritative variable list — the env slice, the `assertConfig()` report and the `.env.example` coverage test all derive from it. |
| `index.ts` | `server-only`. The lazy, memoized `config` object and `ConfigError`. |
| `assert.ts` | `assertConfig()` — validates every domain and reports all failures at once. |
| `client.ts` | `NEXT_PUBLIC_*` only. The one config module a client component may import. |
| `secret.ts` / `primitives.ts` | The `Secret` box; the shared boolean/int/URL coercions. |

Four properties are load-bearing:

- **Accessors are lazy and memoized per domain.** Nothing parses at module load, because `next build` evaluates every module with no secrets present. Each domain parses once per process, so a later `process.env` mutation cannot reintroduce an unvalidated value — which also means **rotating a secret takes effect on restart, not on the next call**. Memoizing per domain rather than globally keeps a broken `LLM_PROVIDER` from failing an unrelated database read.
- **Set-but-invalid always throws.** Unset + a default → the default; unset + required → throw; **set but malformed → throw, never a silent fallback**. `WEBHOOK_QUEUE_MAX_RETRIES=abc` stops the server instead of quietly becoming `3`. Blank (`FOO=`) counts as unset, not as invalid.
- **`assertConfig()` runs at boot**, from the root `instrumentation.ts`, so a misconfigured deployment gets one aggregated report naming every offending variable instead of failing one crash at a time.
- **Secrets are boxed.** `config.auth.jwtSecret` is a `Secret`, not a string: `toString`, `toJSON` (what Pino uses) and `util.inspect` (what `console.log` uses) all render `[redacted]`, and the value is reachable only via `.reveal()`. Validation errors print the variable name and the constraint, never the value.

`instrumentation.ts` at the repo root is the real Next.js hook. `lib/instrumentation.ts` was orphaned before this — Next only loads the hook from the project root or `src/`, so the webhook worker bootstrap that lived there had never run.

## Required env vars (`.env`)

**Required:** `DATABASE_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `AUTH_RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, `EMAIL_INBOX_DOMAINS`.

**Optional, with defaults:** `LOG_LEVEL` (debug in dev, info in prod), `ENABLE_ASYNC_WEBHOOK_PROCESSING` (false), `WEBHOOK_QUEUE_MAX_RETRIES` (3), `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` (5), `ENABLE_BILLING` (false), `WEBHOOK_ALLOW_PRIVATE_NETWORK` (false), `WEBHOOK_EGRESS_ALLOWLIST`, `HEALTHZ_SECRET`, `AUTOMATION_SWEEPER_SECRET`, `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL`, `ENABLE_EMAIL_VERIFICATION` (false), `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` (30), `PASSWORD_RESET_TOKEN_TTL_MINUTES` (30), `ENABLE_MCP` (false), `MCP_ALLOWED_ORIGINS` (empty), `MCP_RATE_LIMIT_MAX` (120), `MCP_RATE_LIMIT_WINDOW_S` (60), and the `AUTH_RATE_LIMIT_*` / `AUTH_LOCKOUT_*` / `RATE_LIMIT_*` / `TRUSTED_PROXY_COUNT` family (see *Auth rate limiting* below).

**Conditionally required:** `REDIS_URL` has **no default** and is required whenever `ENABLE_ASYNC_WEBHOOK_PROCESSING=true` **or** `AUTH_RATE_LIMIT_ENABLED` is on (it defaults to on) — `assertConfig()` refuses to start without it, naming both reasons. A `redis://localhost:6379` fallback was removed deliberately: on a host where the variable was left unset it silently dialled a Redis that either did not exist, or belonged to another service on the same box, so two deployments shared a queue and a rate limiter. `config.redis.url` is therefore `string | null`, and every path that needs a connection goes through `requireRedisUrl()`, which throws naming the variable.

`EMAIL_LINK_SECRET` and `APP_BASE_URL` follow the same pattern: both `null` by default, both required whenever `ENABLE_EMAIL_VERIFICATION=true`, both asserted at boot, and both reached through `requireEmailVerification()`. `APP_BASE_URL` is operator configuration rather than the request's `Host` header on purpose — deriving the link origin from the request hands anyone who controls `Host` (or `X-Forwarded-Host`, behind a proxy that forwards it unvalidated) the domain that appears in the victim's email.

`EMAIL_LINK_SECRET` was renamed from `EMAIL_VERIFICATION_SECRET` and signs **every** emailed link — verification and password reset both — not just verification. The rename is breaking and has no fallback: a deployment still setting `EMAIL_VERIFICATION_SECRET` fails `assertConfig()` at boot naming `EMAIL_LINK_SECRET`, rather than silently starting with signing disabled. `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` and `PASSWORD_RESET_TOKEN_TTL_MINUTES` are both whole minutes, default 30, validated by `assertConfig()` — a duration string like `30m` fails at boot rather than being coerced. The verification TTL was previously a hardcoded 24-hour constant with no env var at all, so on an upgraded deployment that leaves it unset, the window is now 30 minutes, not 24 hours — a real behavior change, not just a config rename.

`.env.example` documents all of them with their formats, and a test fails if the schema and that file drift apart.

**`NEXT_PUBLIC_API_MODE` is not required.** It is validated in `lib/config/client.ts` as `local | external` and is currently informational — `lib/api-client.ts` always builds a same-origin base URL, so nothing branches on it. It is kept rather than deleted because every deployed environment already sets it, and validating it makes a typo visible.

**`JWT_SECRET` has no fallback and never should.** `getJwtSecret()` in `lib/auth-server.ts` resolves it through `config.auth`, which throws when it is unset, blank, or under 16 characters — so `signToken`/`verifyToken` fail closed instead of signing with a guessable value. It is resolved per call rather than captured at module load, because every protected route imports `lib/auth-server` and `next build` evaluates those modules with no secrets in the environment; a module-scope assertion would break the build rather than the misconfigured deployment. Generate one with `openssl rand -base64 32`; rotating it invalidates every issued session and requires a restart to take effect.

**`DATABASE_URL` must carry `options=-c%20timezone%3DUTC`.** This is now enforced: the `db` schema parses the URL, reads its `options` parameter and requires a UTC session timezone, so a connection string without one fails at boot. The check is semantic rather than a substring match, because `URLSearchParams` serialises the space as `+` (`options=-c+timezone%3DUTC`) and that is the same option. Prisma sends timestamps as naive strings, so Postgres interprets them in the *session* timezone before storing them in `timestamptz` columns. A non-UTC session (a Mac inheriting `America/New_York`, say) stores every timestamp shifted by the local offset. Prisma reverses the shift on read, so the ORM looks correct while raw SQL sees the wrong instant — which silently broke the grouped-threads cursor pagination in `app/api/v1/emailInbox/[id]/messages/grouped-query.ts`. The deployed container also pins `timezone = 'UTC'` in `deploy/postgres/postgresql.conf`; the connection option is what covers local dev.

**`EMAIL_INBOX_DOMAINS` is required and asserted at boot.** A comma-separated list of the domains an inbox may be created at, parsed by the `emailInbox` schema in `lib/config/schema.ts` into a validated, de-duplicated `string[]`. Every entry must be verified in Resend *and* have its inbound route pointed at `POST /api/webhooks/email`: mail only ever reaches us for those domains, so an inbox anywhere else is unroutable by construction — created, listed, looking live in the UI, and unable to receive a single message. `assertConfig()` refuses to start without at least one valid entry, so a misconfigured deployment fails loudly at boot rather than serving a creation form that cannot work. Matching is exact — `pibx.dev` does not admit `evil.pibx.dev`. Reaches the browser as `config.emailInboxDomains` on `GET /api/app/auth/me` (see Client-visible config below), never as a `NEXT_PUBLIC_*` var, which would need a rebuild rather than a restart to change.

## Architecture

This is a Next.js 16 App Router app that is **both** the frontend and the API — there is no separate backend. UI pages and `/api/*` route handlers live in the same `app/` tree.

### Request flow

Browser → `lib/api-client.ts` → `/api/app/...` Next.js route handler → `withUser` → service layer → Prisma → PostgreSQL.

- Base URL is built at runtime as `window.location.origin + '/api'` (see `lib/api-client.ts:6`). There is no `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_API_MODE` is validated in `lib/config/client.ts` but nothing branches on it — the client always hits same-origin `/api`. See the note under *Required env vars*.

### Auth (JWT, not cookies)

- **Client**: token in `localStorage.auth_token`. `apiClient` adds `Authorization: Bearer <token>`. On 401 it clears the token and redirects to `/auth/login` unless already on an auth page.
- **Server**: route handlers do not authenticate themselves. Each is wrapped in one of three tagged wrappers from `lib/auth/with-auth.ts`, which resolves the credential and passes a principal in:
  - `withUser` — JWT only, via `resolveUserPrincipalFromToken`. An API key is rejected without a lookup.
  - `withApiKey({ scopes })` — API key only, via `resolveApiKeyPrincipal`. A JWT is rejected without verification, and the declared scopes are checked before the handler runs.
  - `withPublic` — no authentication, and no behavior. It marks intent so "deliberately open" is distinguishable from "someone forgot the wrapper".
- **Credential type is decided by the `sk_live_` prefix before any verification.** The superseded `resolveAuthContext` verified a JWT first and fell back to an API-key lookup on the same header value — the RFC 8725 §2.8 Cross-JWT Confusion class.
- `getAuthenticatedUser` survives for `/api/app/auth/me` only, inside `withUser`, because `formatUserResponse` needs the organization relation the principal resolver deliberately does not load.
- `proxy.ts` (Next.js 16 convention, replaces old `middleware.ts`) excludes `/api` from its matcher and only does pass-through for public pages — **all real auth enforcement is per-route via the wrappers**, not at the proxy level.
- `<AuthGuard>` (in `app/layout.tsx`) is the client-side gate that redirects unauthenticated users to `/auth/login`. `<AuthProvider>` calls `/api/app/auth/me` once on mount and shares the user via `useAuth()` — don't fetch the user yourself, use the context.
- **Public routes**: `/auth/*`, `/api-docs` (Swagger docs), and `/api/app/auth/{login,register}` are accessible without authentication. The page list is `PUBLIC_ROUTES` in `lib/auth/public-routes.ts` — one array, read by `AuthGuard` (the gate), `AuthProvider` and `proxy.ts`. It was three hand-maintained copies, and they had already drifted: both password-reset pages shipped in none of them, so the one page a user who cannot log in would visit redirected them to the login page. `AuthProvider` matches the derived `SESSION_FETCH_SKIPPED_ROUTES` instead — the same list minus `/auth/verify`, which needs its session resolved. A test asserts every directory under `app/auth/` is covered, since consolidating stops the copies drifting but not a new page being added to none of them.

### Auth rate limiting and lockout (issue #42)

`lib/security/rate-limit.ts` throttles `POST /api/app/auth/{login,register}`. Sliding-window *counter* (`estimate = prev × (1 − elapsed/window) + curr`), not a fixed window — a fixed window lets an attacker spend a full budget either side of a boundary for 2× the intended rate. The counter is incremented unconditionally inside one `MULTI` (`INCR`, `PEXPIRE`, `GET prev`), so there is no read-modify-write to race, and rejected attempts count too. Every reply in the `MULTI` is checked, not just the `INCR`: a failed `PEXPIRE` or `GET` makes the limiter *under*-count, which is the direction that must not fail silently.

Defaults: login 20/5min per IP and 10/15min per account; register 10/hour per IP and 5/hour per address; lockout after 5 consecutive failures for 1m doubling to a 15m cap, failure counter TTL 1h. All env-overridable — see `.env.example`.

**Three distinct "no answer from Redis" states, deliberately not collapsed:**

| State | Trigger | Behavior |
|---|---|---|
| Disabled | `AUTH_RATE_LIMIT_ENABLED=false` | No client, no commands, no per-request logging. `degraded` is false — off by policy is not a malfunction. |
| Unconfigured | limiter on, `REDIS_URL` unset | **Never reaches runtime.** `assertConfig()` refuses to boot. |
| Unreachable | configured but down/slow | Bounded by `RATE_LIMIT_TIMEOUT_MS` (250ms) with `enableOfflineQueue: false`, so it is an immediate rejection rather than a hang. `RATE_LIMIT_FAIL_MODE=open` (default) allows and flags `degraded`; `closed` returns 429. |

Refusing to boot is the load-bearing part. An unbacked limiter allows every request and says so only in a log line, so *"auth rate limiting is off"* has to be a decision someone wrote down rather than a variable someone forgot. Fail-open is the runtime default because a Redis outage would otherwise become a full authentication outage, including for the operators who need to log in to fix it.

**Per-account limits report; they do not deny.** The per-IP limit rejects early, before bcrypt — that is the control that caps CPU. The per-account limit and the lockout are consumed up front but the password is still verified, and a *correct* password logs in and clears the lock; only a wrong one gets the 429. Anything keyed on the submitted address is otherwise a weapon aimed at its owner: anyone who knows your email could spend ~1 request per 90 seconds from a single host and keep you permanently unable to log in, and unlike the lockout (capped at 15 minutes) that denial had no ceiling, because the sliding window never decays under sustained pressure.

**`X-Forwarded-For` trust model.** Caddy is the only public ingress (`deploy/docker-compose.yml` publishes ports on `caddy` alone; `app` is internal-only) and its `reverse_proxy` *appends* the TCP peer to any inbound XFF. The chain is therefore `[...client-forged..., real IP]` and we take the entry at `length − TRUSTED_PROXY_COUNT` — **rightmost by default, never `split(',')[0]`**, which anyone could forge to mint a fresh budget per request. Set `TRUSTED_PROXY_COUNT=2` for a CDN in front of Caddy. IPv6 buckets by /64 (with `::` expanded first), since end users routinely get a whole /64.

When no trustworthy address can be derived — header absent, chain shorter than the declared hop count, or `TRUSTED_PROXY_COUNT=0` — `getClientIp` returns `null` and **per-IP limiting is skipped**, with a throttled warning. It does *not* fall back to a shared `unknown` bucket: that would put every user of a proxy-less deployment (or `npm run dev`) into one 20-per-5-minutes login budget, which is a self-inflicted auth outage rather than a conservative default. Per-account limiting and lockout are unaffected. `X-Real-IP` is deliberately not a fallback — if XFF is absent there is no evidence a trusted proxy was involved, so it is exactly as forgeable.

**Enumeration safety.** One message for every throttled outcome (`Too many login attempts. Please try again later.`), so a 429 carries no signal about account existence; per-account limits and failure counters key on the **submitted** address (SHA-256 bucketed, so no PII in Redis) and are recorded for unknown addresses too, otherwise lockout itself becomes the oracle. A test asserts the throttled response is identical for a real vs. non-existent account. Login compares against a dummy cost-10 hash when no user matches, fixing a pre-existing timing oracle where the bcrypt round was skipped entirely.

`/api/healthz` reports limiter state (`rate_limit.state`) in its authenticated detail block. It is **passive** — derived from what real requests experienced, not a probe — and a degraded limiter does not fail the health check, since fail-open means logins still work and a 503 would pull a working instance out of its load balancer.

`lib/automations/replay-rate-limit.ts` (issue #40) is a second, narrower limiter with its own connection. The two should be unified onto this module.

### Response envelope (load-bearing)

All API routes use `lib/api-helpers.ts`:
- `jsonSuccess(data, status)` → `{ data }`
- `jsonError(message, status)` → `{ message }`

`lib/api-client.ts:147` unwraps `data.data` automatically. **If you write a route that returns a bare object instead of using `jsonSuccess`, the client will silently get the wrong shape.**

### Multi-tenancy model

Every resource (EmailInbox, PhoneInbox, ApiKey, Webhook, EmailMessage) is scoped to an `Organization` via `organizationId`, and a user accesses orgs through `Membership`.

Handlers never query with a principal. They convert it into one of two scope types from `lib/services/scope.ts` and pass only that to the service layer, which therefore cannot branch on credential type:

- **`OrgScope` — who can SEE.** Organization-wide for both principal kinds: a user gets every organization they belong to, a key gets the one it is bound to. Produced by `toOrgScope(principal, requestedOrganizationId?)`, which is the single place the membership check happens. A route cannot narrow to an organization without being checked.
- **`OwnerScope` — who can CHANGE.** Creator-only, and deliberately a different type. Only a `UserPrincipal` can produce one (`toOwnerScope`), so **no API key can reach a mutating service** — enforced by the compiler, independently of which route tree the handler lives in. There is a type test for this in `lib/services/__tests__/scope.test-d.ts`.

Reads widened to organization-wide; mutation authority did not. A user therefore sees inboxes they cannot rename, delete or send from, which is why `serializeAppInbox` derives `isOwner` — the UI gates on it rather than rendering actions that 404.

### The four route trees

| Tree | Wrapper | Contents |
|---|---|---|
| `app/api/v1/**` | `withApiKey` | The published external API. **Read-only** — GET handlers only. |
| `app/api/app/**` | `withUser` (`withPublic` for `auth/login`, `auth/register`, `auth/verification/confirm`, `auth/password-reset/*`) | Everything the dashboard calls. |
| `app/api/webhooks/**` | `withPublic` | Provider ingest, which authenticates the *request* by HMAC rather than the caller. |
| `app/api/mcp` | `withApiKey({ scopes: [] })` | The MCP server (issue #104). One POST; scopes are enforced per tool, not per route. |

`lib/__tests__/route-guards.test.ts` enforces this structurally, by importing every route module and reading a non-enumerable symbol the wrappers attach. Source-text matching cannot answer "was this wrapped?" honestly; a symbol can only be present if the wrapper actually ran. The guards assert no mutating handler exists under `/api/v1`, each tree carries its expected wrapper (guard 8 covers `app/api/mcp`), no handler is untagged, and every documented OpenAPI path sits under `/api/v1`.

Serializers are hand-written allowlists (`lib/serializers/public/` for the external contract, `lib/serializers/app/` for the dashboard, `lib/serializers/mcp/` for the MCP surface) so a column added to the schema cannot publish itself. The public ones are snapshot-tested. Note the snapshots catch *additions*; they do not catch omitting a field a consumer already reads.

### API Key security architecture

API keys use **SHA-256 hashing** with scopes for fine-grained access control:

- **Storage**: `apiKey` field stores `null` (never store raw key); `keyHash` stores SHA-256 hash; `prefix` stores first 12 chars of raw key for display
- **Creation** (`POST /api/v1/apiKeys`): Returns full `sk_live_*` prefixed key exactly once — user must copy/save it immediately
- **Listing** (`GET /api/v1/apiKeys`): Returns serialized response via `serializeApiKey()` which exposes only `prefix` (12-char identifier) and `scopes`, never the raw key or hash
- **Scopes**: exactly `inboxes:read` and `messages:read` — validated against `API_KEY_SCOPE_SET` on creation. There are no write scopes; the external surface is read-only. `messages:delete` was retired and migrated away in `prisma/migrations/*_retire_messages_delete_scope`. `DEFAULT_API_KEY_SCOPES` is enumerated explicitly rather than spread from the list, so a future write scope cannot become a default grant by accident.
- **Validation**: scope enforcement lives in the `withApiKey` wrapper, declared per route beside the HTTP method rather than inside the handler body

### Email verification at signup (issue #102)

Off unless `ENABLE_EMAIL_VERIFICATION=true`, in which case signup still returns a session token but **every `withUser` route returns 403 `Email verification required` until the address is proven** — a soft gate, not a login block.

- **The token is not a session token, by three independent barriers.** It is signed with `EMAIL_LINK_SECRET` (never `JWT_SECRET`), carries `{ purpose: 'email_verify', userId, email }` where a session token carries only `{ userId }`, and `lib/auth/__tests__/verification-token.test.ts` asserts the boundary in both directions. `verifyToken` additionally rejects **any** payload carrying a `purpose` claim. This matters more than usual because a verification link travels by email — it lands in mail provider logs, corporate link scanners and browser history — so reintroducing the RFC 8725 §2.8 Cross-JWT Confusion class here would be strictly worse than the `resolveAuthContext` instance this repo already removed.
- **Stateless: no token table, no cleanup job.** The token is not revocable and a resend does not invalidate earlier links. Both are safe because redemption is idempotent and self-limiting — it grants exactly one transition, `emailVerified: false → true`, for one `(userId, email)` pair, and confers no session and no scope. Changing the address invalidates every outstanding link, because `confirm` compares the claim against the row.
- **`withUser` gained an opt-out, not an opt-in.** `withUser({ allowUnverified: true }, handler)` — verification is required by default, so a new route that never considered it fails closed. The allowlist is exactly `auth/me` (the gate screen is built from it) and `auth/verification/resend` (only an unverified user calls it); `auth/verification/confirm` is `withPublic`. Guard 7 in `lib/__tests__/route-guards.test.ts` pins that set by reading the flag off the wrapper's symbol, so a fourth route quietly opting out fails the suite.
- **`withApiKey` is deliberately not gated.** A key can only be minted from the dashboard, which is behind the gate, so an unverified user cannot obtain one — and every pre-existing key belongs to a grandfathered user. Checking would cost a `User` lookup per external request to enforce an unreachable state.
- **Existing users are grandfathered** by `prisma/migrations/*_email_verification`, which sets `emailVerified = true` for every row. Without it, flipping the flag on locks out the entire current userbase at once. The backfill runs regardless of the flag's value, which is safe because nothing but the serializer reads the column while the feature is off. Accepted trade-off: never-proven addresses are now marked proven.
- **A send failure never fails the signup.** The account is already committed, so a 500 would leave the user with an account they believe does not exist. It logs at `error`, leaves `verificationEmailSentAt` unset, and the gate screen's Resend button is the recovery path. Resend is throttled by `RESEND_COOLDOWN_SECONDS` against the `verificationEmailSentAt` column rather than an in-process map — the app runs as more than one container, and an in-memory throttle is defeated by round-robin and resets on every deploy.
- **Client**: `emailVerificationRequired` on `AppConfig` drives `AuthGuard`, which renders `<VerifyEmailNotice />` in place of children. `/auth/verify` is in `AuthGuard`'s `PUBLIC_ROUTES` but deliberately **not** in `AuthProvider`'s, so a session is still resolved there and the page can refresh the user in place instead of demanding a second login. The page scrubs the token from the URL with `history.replaceState` before anything can observe it, and always calls `refreshUser()` after redeeming — `isAuthenticated` inside that mount effect is the pre-`/auth/me` value, so branching on it would skip the refresh every time and leave a stale `emailVerified: false` that re-engages the gate on the next page.

Rollback is setting the flag back to `false`; no schema reversal, and users verified meanwhile stay verified. Deferred: re-verification on email change (no email-change flow exists yet — when one lands it must set `emailVerified = false`), and bounce handling.

### Password reset (signed JWT)

Shares both the `ENABLE_EMAIL_VERIFICATION` flag and its signing key: reset
links and verification links are both signed with `EMAIL_LINK_SECRET`. **The
`purpose` claim is therefore the only thing separating the two token types** —
the signature check cannot tell them apart. Each verifier tests `purpose` for
strict equality before reading any other claim, and
`lib/auth/__tests__/password-reset-token.test.ts` asserts cross-redemption
fails in both directions. Those tests are the barrier, not a formality.

Forging across purposes is not possible without the key, since `purpose` is
inside the signed payload — the risk being defended against is a verifier
defect, not an attacker with a token. Separately, `verifyToken` rejects any
payload carrying a `purpose` claim at all, so neither emailed token can ever be
presented as a session credential.

The token carries `pwh`, a fingerprint of the password hash it was issued
against, which is what makes a stateless token single-use: completing a reset
changes the hash, so every outstanding link dies at once with no token table to
sweep. Confirm also stamps `passwordChangedAt`, and
`resolveUserPrincipalFromToken` rejects any session JWT issued before it — so a
reset evicts an attacker's existing session rather than leaving it live for the
rest of its 7 days.

`POST /api/app/auth/password-reset/request` returns an identical
`{ requested: true }` for every outcome once the feature is enabled — unknown
address, cooldown hit, Resend failure — because it accepts a third-party
address and any outcome-dependent response makes it an account-existence
oracle. The response body is uniform; response *timing* is not, which is a
known and accepted gap. The address lookup is case-sensitive — trimmed but not
lowercased, matching registration and login — because Postgres `@unique` is
case-sensitive and `User@Example.com` is a distinct, loginable row;
lowercasing here would leave such an account permanently unable to reset, and
the uniform response would hide why.

Confirm issues no session. The user signs in afterwards, which proves the reset
worked and keeps an emailed link from being convertible into a session.

### Inbox creation policy (issue #98)

Address *syntax* validation (`lib/email-address.ts`) never claimed to know which domains we can receive at, so creation used to accept any well-formed address. Two rules now sit on every write path, both in `lib/validation/inbox-policy.ts`:

- **Domain allowlist** — `EMAIL_INBOX_DOMAINS` (above). Unconfigured → 503; wrong domain → 400.
- **Impersonation blocklist** — `lib/security/blocked-inbox-terms.ts`, applied to the local part *and* the display name → 422. Because every inbox now sits on a domain we own and genuinely receive at, `amazon-security@<our-domain>` is not a spoof but a working address for collecting phishing replies; `pi-support@` is the same aimed at our own users. Matching normalizes (lowercase → leetspeak fold → strip non-alphanumerics) so `g-o-o-g-l-e`, `g00gle` and `g.o.o.g.l.e` all collapse to `google`. Distinctive brands match as substrings; short or English-colliding terms (`pi`, `x`, `ups`, `chase`, `meta`, `wise`) match only as standalone tokens, so `pizza` and `purchase` survive. Display names are additionally ASCII-only — a Cyrillic `Аmazon` normalizes to `mazon` and only the charset guard stops it.
- **Length caps** — `MAX_LOCAL_PART_LENGTH` (50) and `MAX_NAME_LENGTH` (100) in `lib/validation/inbox-policy-messages.ts`, both → 400. Deliberately tighter than the RFC 254-character *address* cap in `lib/email-address.ts`, which answers "can SMTP route this" rather than "would we provision this". The local-part cap also limits the padding available for burying a lookalike past the substring blocklist. The local part is measured after normalization, the display name after trimming; a blank name is still an absent optional field, not a violation. Existing rows predating the caps are untouched — the address is immutable on `PATCH`, but a name over 100 characters must be shortened before that inbox can be renamed at all.

**Both routes must call the policy, and rename is not optional.** `PATCH /api/app/emailInbox/[id]` runs the same name check as `POST`; without it an inbox is created as `qa` and renamed to `Amazon Support` afterwards, and the blocklist is worthless. The rules live in `lib/` rather than a route handler precisely so a future creation path cannot quietly skip them.

The client half (`components/create-email-dialog.tsx`) composes the address from a local-part input plus a fixed suffix (one domain) or a `Select` (two or more) — the user cannot type a domain at all — and shows inline field errors. It is convenience; the server rejects the same inputs when a request bypasses the UI. Shared wording lives in `lib/validation/inbox-policy-messages.ts`, which imports nothing so the client can use it without pulling Pino into the browser bundle.

The allowlist reaches the browser as `config.emailInboxDomains` on `GET /api/app/auth/me` — see the `AppConfig` note under Response envelope below — never as a `NEXT_PUBLIC_*` var, which would be inlined at build time and need a rebuild to change.

### Client-visible config (`AppConfig`)

`GET /api/app/auth/me` returns the user fields plus a sibling `config` object built by `getAppConfig()` (`lib/config/app-config.ts`). `AuthProvider` already fetches that route once on mount, so config costs no extra round-trip; read it through `useAuth().config`, never off `user.config`. `login`/`register` deliberately do **not** carry it — they nest the user under `{ user: ... }` and are followed by a `/me` refetch anyway, hence `User.config` is optional.

**`AppConfig` is an allowlist type and the review gate.** Everything in it is published to every authenticated user, so nothing secret goes in it; `lib/config/__tests__/app-config.test.ts` pins the exact key set so an addition cannot land unnoticed. `useAuth()` falls back to empty values when the server sends none — empty must always read as "feature unavailable", never "no restrictions".

### Email ingestion (Resend webhook)

`app/api/webhooks/email/route.ts` receives `email.received` events from Resend.
- **HMAC validation**: `x-webhook-signature` + `x-webhook-timestamp` headers, verified against `WEBHOOK_SECRET`, with a 5-minute replay window (`validateSignature`). Uses `crypto.timingSafeEqual`.
- **Threading**: `determineThreading` first matches by `In-Reply-To` / `References` headers against `EmailMessage.messageId`, then falls back to subject match (stripped `Re:`/`Fwd:` prefix) within the same inbox. New threads use the new message's own DB id as `threadId`.
- Resend's outgoing `Message-ID` doesn't always match what the recipient sees, hence the subject fallback — don't remove it.
- Duplicates are silently skipped via Prisma error code `P2002` on the `(externalId, inboxEmailAddressId)` unique constraint.

### Message search (issue #106)

Four query parameters on **both** `GET /api/app/emailInbox/[id]/messages` and `GET /api/v1/emailInbox/{id}/messages`: `q` (full-text over subject and body), `from` (case-insensitive substring), `tags` and `categories` (exact, OR within a parameter, AND across them). Both routes call the same parser, `lib/search/message-search-params.ts`, so the published contract and the dashboard cannot drift apart on what a parameter means.

**Search filters; it does not rank.** Results stay `createdAt DESC, id DESC` and the existing `(createdAt, id)` keyset cursor keeps working verbatim, so a client can add `?q=` to a request without a second pagination contract. `ts_rank` ordering would need a float in the cursor and is deliberately deferred.

**`grouped=true` + any search parameter is a 400.** Grouped mode collapses to one row per thread via `DISTINCT ON`, and every available answer for "what does it mean for a *thread* to match" either changes what `threadCount` counts or returns a row that does not contain the search term. The dashboard list defaults to grouped, so a search UI must send `grouped=false`.

**`EmailMessage.bodyText`** holds the searchable plain text: the sender's `text` part when there is one, otherwise text extracted from `html` by `lib/email/extract-body-text.ts` (the `html-to-text` package). It is derived at write time on both paths that create messages — the webhook ingest and the send route — and deliberately *not* during enrichment, which is LLM-gated and optional; "searchable only once enriched" would be an invisible gap. Extraction uses a real parser rather than a tag-stripping regex because templated marketing mail carries multi-kilobyte `<style>` blocks, and indexing those fills the vector with CSS selectors.

**`EmailMessage.searchVector` is a STORED generated column**, not a trigger and not an application write, so the index cannot drift from the row. Three things about it are load-bearing:

- **`to_tsvector` is called with an explicit `'english'::regconfig`.** The one-argument form resolves `default_text_search_config` at call time and is therefore STABLE, not IMMUTABLE; Postgres rejects it in a generated column with *"generation expression is not immutable"*.
- **The `left(...)` caps are a correctness bound.** `to_tsvector` raises once the vector exceeds 1 MB and a generated column is computed during `INSERT`, so without them an oversized email would not merely be unsearchable — it would **fail ingestion**. Verified: 300k distinct words needs 3.4 MB and aborts; capped at 100k characters it is ~220 KB. The cap is duplicated in `MAX_BODY_TEXT_LENGTH`, but the SQL one is what makes the failure unreachable.
- **The `@default(dbgenerated(...))` on the field is not a default** — the column has none. It is the only way to tell Prisma's differ the value comes from an expression, and it must match `information_schema` byte for byte. Without it `prisma migrate diff` reports permanent drift and the next `prisma migrate dev` offers to "fix" it by dropping the generation expression, silently turning the search index into a column nothing writes.

**Existing rows were not backfilled.** The `ALTER TABLE` rewrite computes the vector for every row, so subject search covers all mail immediately and body search covers everything that arrived with a text part — the expression is `coalesce("bodyText", text, '')`. Only the bodies of pre-existing HTML-only mail are missing. A batched re-derive is the escape hatch if that gap matters; writing `bodyText` updates the generated column automatically.

**Querying is raw SQL** (`lib/services/message-search.ts`), because Prisma's `search` operator needs a preview flag, emits `to_tsquery` — which *raises* on input like a stray `&`, turning a search box into a 500 — and cannot reference an `Unsupported` column at all. `websearch_to_tsquery` is total and gives callers `"quoted phrases"`, `or` and `-negation` for free. Consequences that must not be "simplified" away:

- **`deletedAt IS NULL` is written by hand.** Raw SQL bypasses the soft-delete extension in `lib/db.ts`; without it search is a read path that serves deleted mail.
- **`from` is LIKE-escaped** (`\`, `%`, `_`). Unescaped, `from=%` is a filter that silently matches everything.
- **`MESSAGE_COLUMNS` (`lib/services/message-columns.ts`) exists to keep `searchVector` out of the projection.** A tsvector over a 100k-character body is ~220 KB, so a `SELECT *` on a 50-row page would drag ~11 MB out of Postgres for a column no serializer reads. `grouped-query.ts` was switched off `SELECT *` for the same reason — Postgres has no `SELECT * EXCEPT`. Add new columns to that list.

Stop words follow from the `english` configuration: a query of only common words (`the is`) matches nothing rather than everything. Non-English mail degrades to roughly `simple` behaviour; per-message language detection is out of scope.

`bodyText` and `categories` are now in **both** serializers. `categories` was previously withheld from the public contract as worker-internal state; shipping a `categories` filter while hiding the field would mean callers filter on something they cannot read back.

A third caller now uses the same parser: `pibx_email_search_messages` on the MCP surface (below). It renders its typed arguments back into a `URLSearchParams` and hands them to `parseMessageSearch` rather than building a `MessageSearch` itself — the one-parser guarantee is only worth as much as the number of callers that actually go through it.

### MCP server (issue #104)

`POST /api/mcp` exposes the read-only email surface over MCP, authenticated with an existing `sk_live_` API key. Off unless `ENABLE_MCP=true`, in which case the route 404s — a feature that is off should not advertise that it exists.

**Tool handlers call the service layer in process.** `toOrgScope(principal)` → `listMessages(scope, …)`, exactly as the `/api/v1` routes do. Building MCP as a shim that forwards the caller's key to our own `/api/v1` would be the token-passthrough pattern the MCP security spec forbids outright ("MCP servers MUST NOT pass through the token received from the MCP client"); "both ends are ours" is not an exemption, and in-process avoids it by construction.

**Nothing here can mutate, and that is a type-level fact rather than a policy.** A mutating service takes an `OwnerScope`, `toOwnerScope` accepts only a `UserPrincipal`, and the only principal reaching this tree is an `ApiKeyPrincipal` — so the compiler refuses a write regardless of what a prompt-injected model asks for. That property is the entire reason it is defensible to let a model choose the calls.

Six tools, all prefixed `pibx_email_`: `list_inboxes`, `list_messages`, `search_messages`, `get_message`, `get_thread`, `get_latest_otp`. Two segments in the prefix doing two jobs — `pibx_` because tool names are only server-scoped and users connect many servers, `email_` because a `PhoneInbox` already exists in the schema and MCP has no alias mechanism, so a rename after the first client config exists is a hard break.

- **`search_messages` is a separate tool from `list_messages`, and has no `grouped` argument.** `parseMessageSearch` rejects grouped+search with a 400; a single tool carrying both would advertise a combination guaranteed to fail, and a model will try it. Omitting the field makes the invalid state unrepresentable in the schema instead of caught at runtime.
- **Schemas are plain JSON Schema through `fromJsonSchema`, not Zod.** This repo is on `zod@3` and `@modelcontextprotocol/server` installs `zod@4` nested; schemas from one instance are not reliably readable by the other. The SDK only needs a JSON Schema to advertise and a validator, and `fromJsonSchema` supplies both — so the version question never arises. Argument validation still happens (a missing required field comes back as `isError`, not a crash).
- **Every tool is annotated `readOnlyHint: true`.** The spec defaults are `destructiveHint: true` and `openWorldHint: true`, so omitting annotations advertises these as destructive, and clients gate confirmation prompts on it.
- **`isError: true` vs a JSON-RPC error is a real distinction.** Anything the caller could fix by calling differently — missing scope, invisible inbox, bad cursor, a search parameter over its cap — is a tool result with a corrective sentence. JSON-RPC errors are reserved for unknown-tool and malformed-request.
- **`lib/serializers/mcp/` defaults to snippets and never emits `html` at any verbosity.** Claude Code caps a tool result at 25,000 tokens; one templated marketing email can clear the warning threshold alone. Full bodies come from `get_message` or `response_format: detailed`, and even those are capped with a marker saying how much was dropped — without it a model reads a truncated body as a complete one.
- **The server object is built per request**, closing over that request's principal. The transport is stateless, so there is nothing to reuse, and a module-level server would need the principal in a mutable global that concurrent requests would race on.

`withApiKey({ scopes: [] })` looks like it checks nothing; the empty array satisfies the route-level AND-check while still resolving the key, enforcing revocation and expiry, and attaching the `'apiKey'` tag the guards read. Scopes are then checked per tool, because one route-level declaration cannot express "this call needs `inboxes:read` and that one needs `messages:read`" when both arrive down the same POST.

`MCP_ALLOWED_ORIGINS` is the DNS-rebinding defense the transport spec requires: **absent `Origin` is allowed, present-and-unknown is refused**, and the list is empty by default. Every supported client (Claude Code, Cursor, VS Code, claude.ai) is a server-side or native caller that sends no `Origin`, so the default costs nothing real. The expected origin is operator configuration and never derived from the request — comparing against `Host`/`X-Forwarded-Host` would let the attacker supply both sides of the comparison, the same call already made for `APP_BASE_URL`.

Rate limiting reuses `lib/security/rate-limit.ts` under a new `mcp` scope rather than adding a third limiter, keyed on `apiKeyId` — a credential we issued is a stabler bucket than an address behind a shared NAT, and it is present on every request here, unlike a trustworthy IP.

The route returns the JSON-RPC envelope **verbatim**, a deliberate exception to the `jsonSuccess` rule: wrapping it would make the response unparseable to every MCP client, and `lib/api-client.ts` (which auto-unwraps `data.data`) never calls this route. MCP paths must also stay out of `lib/openapi/email-inboxes.ts` — guard 6 requires every documented path to start with `/api/v1`.

**Not in `AppConfig`.** Nothing in the dashboard branches on whether MCP is on, and `AppConfig` is an allowlist published to every authenticated user; adding a key there is a review gate, not a default.

### Prisma 7 (non-default setup)

- Generator is `prisma-client` (NOT `prisma-client-js`), output to `lib/generated/prisma` (gitignored).
- Import from `@/lib/generated/prisma/client`, **not** `@prisma/client`. Enums (e.g. `WebhookStatus`) also import from there.
- Datasource URL lives in `prisma.config.ts` (`process.env.DATABASE_URL`), not in `schema.prisma`.
- `PrismaClient` **requires** the `@prisma/adapter-pg` adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. The shared instance is in `lib/db.ts` with the standard global-singleton pattern for hot reload.

### Next.js 16 specifics

- Dynamic route params are async: `{ params }: { params: Promise<{ id: string }> }`, must `await params`. See `app/api/v1/apiKeys/[id]/route.ts:6`.
- Dev/start ports default to 4000 in `package.json`.

### Testing (Vitest + MSW + jsdom)

- `test/setup.ts` starts MSW with `onUnhandledRequest: 'error'` — every fetch in a test must have a handler in `test/mocks/handlers.ts` or be overridden per-test.
- `next/navigation`, `next/link`, and `next-themes` are mocked globally in setup. `localStorage` is cleared between tests; `window.confirm` returns true; `navigator.clipboard` is stubbed.
- `vitest.config.ts` sets `NEXT_PUBLIC_API_MODE=local` and aliases `@` to repo root (matches `tsconfig.json` paths).
- **`AUTH_RATE_LIMIT_ENABLED=false` in the test baseline**, unlike production. Suites that exercise the limiter turn it on with `withConfigEnv` *and* inject a `FakeRedis`; the default only ever affected suites doing neither, which reached the `REDIS_URL` fixture and talked to whatever Redis the developer had running. Counters then survive between runs, so `npm test` a few times within the hour trips the 5-per-hour register limit and fails tests that have nothing to do with rate limiting — while CI, with nothing on 6379, stays green.
- Component tests live in `components/__tests__/` and `app/api-keys/__tests__/`.

### Integration tests (real Postgres)

`npm run test:integration` runs `test/integration/**` against a real database — no
mocks for db/auth. Requires `.env.test` with `TEST_DATABASE_URL` pointing at a
dedicated DB whose name contains "test" (a safety guard refuses anything else).
The DB is created, migrated, and dropped per run (`KEEP_TEST_DB=1` to keep it).
These are excluded from `npm test`.

**`TEST_DATABASE_URL` is the only variable an operator sets.** `vitest.integration.config.ts`
loads `.env.test` itself, so nothing has to be exported by hand — previously nothing
loaded it at all and the suite died on an unset `TEST_DATABASE_URL` with the file
sitting right there. It loads `.env.test` and deliberately **not** `.env`: Vite's
`loadEnv()` would pull in the development `DATABASE_URL`, and this suite `TRUNCATE`s
every table it can reach. `override: false`, so a genuinely exported variable still
wins and CI can inject the URL directly.

Every other variable the app needs in order to boot — `JWT_SECRET`, `WEBHOOK_SECRET`,
`HEALTHZ_SECRET`, `AUTOMATION_SWEEPER_SECRET`, `AUTH_*`, `EMAIL_INBOX_DOMAINS` — is
assigned by `test/integration/setup/setup.ts`, unconditionally, and cannot be
configured from `.env.test`. They are fixtures rather than deployment config: no test
asserts anything about their values, so a run whose outcome depends on what an operator
typed is not reproducible. This is not hypothetical — a local `.env.test` carrying
`JWT_SECRET=test-jwt-secret` sat one character under the 16-char floor `lib/config`
enforces, and failed all 233 tests with a `ConfigError` raised at the first `signToken`,
nowhere near the file at fault. Assignment is unconditional rather than
default-if-unset for that exact reason: deferring to a value an operator already got
wrong would leave the trap armed.

## Known issues & vulnerabilities

**TypeScript errors (pre-existing)**:
- `app/phones/[id]/page.tsx` and `app/phones/page.tsx` have TS errors around `MobileSidebarProps`
- `package.json#name` is still `my-v0-project` from the v0.app scaffold
- `test/integration/setup/setup.ts` uses top-level await, which trips TS1378 under the repo's `tsconfig` target (harmless — Vitest/esbuild transpiles it; `next build` has `ignoreBuildErrors`)

**Security vulnerabilities** (pre-existing, require major version upgrades):
- **Next.js 16.0.3**: Multiple critical RCE, DoS, and XSS vulnerabilities. Requires upgrade to 16.2.7+ (breaking changes). See `npm audit` for details.
- **PostCSS**: XSS via unescaped `</style>` tags (bundled with Next.js)
- **@hono/node-server**: Middleware bypass via repeated slashes (used transitively via Prisma)
- Peer dependency warnings from `swagger-ui-react` are non-critical (works with React 19 despite only declaring support for 15-18)
