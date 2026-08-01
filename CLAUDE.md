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

**Optional, with defaults:** `LOG_LEVEL` (debug in dev, info in prod), `ENABLE_ASYNC_WEBHOOK_PROCESSING` (false), `WEBHOOK_QUEUE_MAX_RETRIES` (3), `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` (5), `ENABLE_BILLING` (false), `WEBHOOK_ALLOW_PRIVATE_NETWORK` (false), `WEBHOOK_EGRESS_ALLOWLIST`, `HEALTHZ_SECRET`, `AUTOMATION_SWEEPER_SECRET`, `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL`.

**Conditionally required:** `REDIS_URL` has **no default** and is required whenever `ENABLE_ASYNC_WEBHOOK_PROCESSING=true` — `assertConfig()` refuses to start without it. A `redis://localhost:6379` fallback was removed deliberately: on a host where the variable was left unset it silently dialled a Redis that either did not exist, or belonged to another service on the same box, so two deployments shared a queue and a rate limiter. `config.redis.url` is therefore `string | null`, and every path that needs a connection goes through `requireRedisUrl()`, which throws naming the variable.

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
- **Public routes**: `/auth/*`, `/api-docs` (Swagger docs), and `/api/app/auth/{login,register}` are accessible without authentication.

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

### The three route trees

| Tree | Wrapper | Contents |
|---|---|---|
| `app/api/v1/**` | `withApiKey` | The published external API. **Read-only** — GET handlers only. |
| `app/api/app/**` | `withUser` (`withPublic` for `auth/login`, `auth/register`) | Everything the dashboard calls. |
| `app/api/webhooks/**` | `withPublic` | Provider ingest, which authenticates the *request* by HMAC rather than the caller. |

`lib/__tests__/route-guards.test.ts` enforces this structurally, by importing every route module and reading a non-enumerable symbol the wrappers attach. Source-text matching cannot answer "was this wrapped?" honestly; a symbol can only be present if the wrapper actually ran. The guards assert no mutating handler exists under `/api/v1`, each tree carries its expected wrapper, no handler is untagged, and every documented OpenAPI path sits under `/api/v1`.

Serializers are hand-written allowlists (`lib/serializers/public/` for the external contract, `lib/serializers/app/` for the dashboard) so a column added to the schema cannot publish itself. The public ones are snapshot-tested. Note the snapshots catch *additions*; they do not catch omitting a field a consumer already reads.

### API Key security architecture

API keys use **SHA-256 hashing** with scopes for fine-grained access control:

- **Storage**: `apiKey` field stores `null` (never store raw key); `keyHash` stores SHA-256 hash; `prefix` stores first 12 chars of raw key for display
- **Creation** (`POST /api/v1/apiKeys`): Returns full `sk_live_*` prefixed key exactly once — user must copy/save it immediately
- **Listing** (`GET /api/v1/apiKeys`): Returns serialized response via `serializeApiKey()` which exposes only `prefix` (12-char identifier) and `scopes`, never the raw key or hash
- **Scopes**: exactly `inboxes:read` and `messages:read` — validated against `API_KEY_SCOPE_SET` on creation. There are no write scopes; the external surface is read-only. `messages:delete` was retired and migrated away in `prisma/migrations/*_retire_messages_delete_scope`. `DEFAULT_API_KEY_SCOPES` is enumerated explicitly rather than spread from the list, so a future write scope cannot become a default grant by accident.
- **Validation**: scope enforcement lives in the `withApiKey` wrapper, declared per route beside the HTTP method rather than inside the handler body

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
- Component tests live in `components/__tests__/` and `app/api-keys/__tests__/`.

### Integration tests (real Postgres)

`npm run test:integration` runs `test/integration/**` against a real database — no
mocks for db/auth. Requires `.env.test` with `TEST_DATABASE_URL` pointing at a
dedicated DB whose name contains "test" (a safety guard refuses anything else).
The DB is created, migrated, and dropped per run (`KEEP_TEST_DB=1` to keep it).
These are excluded from `npm test`.

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
