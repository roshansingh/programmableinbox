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
- **Environment**: `LOG_LEVEL` env var (valid: `debug`, `info`, `warn`, `error`, `fatal`); falls back to `debug` (dev) or `info` (prod)
- **Error serialization**: Both `err` and `error` keys use Pino's error serializer for consistent stack traces
- **Singleton**: Lazy-loaded via Proxy pattern in `lib/logger.ts` — module load has zero overhead
- **Route instrumentation**: API routes use `logger.error({ error }, 'message')` on failures; use `logger.info()` for success logging with context

## Required env vars (`.env`)

`DATABASE_URL`, `JWT_SECRET`, `AUTH_RESEND_API_KEY`, `WEBHOOK_SECRET`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, `NEXT_PUBLIC_API_MODE`.

**`JWT_SECRET` has no fallback and never should.** `getJwtSecret()` in `lib/auth-server.ts` throws when it is unset or empty/whitespace, so `signToken`/`verifyToken` fail closed instead of signing with a guessable value. It is read per call, not at module load, because every protected route imports `lib/auth-server` and `next build` evaluates those modules with no secrets in the environment — a module-scope assertion would break the build rather than the misconfigured deployment. Generate one with `openssl rand -base64 32`; rotating it invalidates every issued session.

**`DATABASE_URL` must carry `options=-c%20timezone%3DUTC`.** Prisma sends timestamps as naive strings, so Postgres interprets them in the *session* timezone before storing them in `timestamptz` columns. A non-UTC session (a Mac inheriting `America/New_York`, say) stores every timestamp shifted by the local offset. Prisma reverses the shift on read, so the ORM looks correct while raw SQL sees the wrong instant — which silently broke the grouped-threads cursor pagination in `app/api/v1/emailInbox/[id]/messages/grouped-query.ts`. The deployed container also pins `timezone = 'UTC'` in `deploy/postgres/postgresql.conf`; the connection option is what covers local dev.

## Architecture

This is a Next.js 16 App Router app that is **both** the frontend and the API — there is no separate backend. UI pages and `/api/*` route handlers live in the same `app/` tree.

### Request flow

Browser → `lib/api-client.ts` → `/api/...` Next.js route handler → `getAuthenticatedUser` → Prisma → PostgreSQL.

- Base URL is built at runtime as `window.location.origin + '/api'` (see `lib/api-client.ts:6`). There is no `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_API_MODE=local` is set but currently the client always hits same-origin `/api`.

### Auth (JWT, not cookies)

- **Client**: token in `localStorage.auth_token`. `apiClient` adds `Authorization: Bearer <token>`. On 401 it clears the token and redirects to `/auth/login` unless already on an auth page.
- **Server**: `getAuthenticatedUser(request)` in `lib/auth-server.ts` parses the bearer token, verifies via `jsonwebtoken`, and loads the user with `memberships.organization` included. Every protected route calls this and returns `jsonError('Unauthorized', 401)` on null.
- `proxy.ts` (Next.js 16 convention, replaces old `middleware.ts`) excludes `/api` from its matcher and only does pass-through for public pages — **all real auth enforcement is per-route via `getAuthenticatedUser`**, not at the proxy level.
- `<AuthGuard>` (in `app/layout.tsx`) is the client-side gate that redirects unauthenticated users to `/auth/login`. `<AuthProvider>` calls `/api/auth/me` once on mount and shares the user via `useAuth()` — don't fetch the user yourself, use the context.
- **Public routes**: `/auth/*`, `/api-docs` (Swagger docs), and `/api/auth/login` are accessible without authentication.

### Response envelope (load-bearing)

All API routes use `lib/api-helpers.ts`:
- `jsonSuccess(data, status)` → `{ data }`
- `jsonError(message, status)` → `{ message }`

`lib/api-client.ts:147` unwraps `data.data` automatically. **If you write a route that returns a bare object instead of using `jsonSuccess`, the client will silently get the wrong shape.**

### Multi-tenancy model

Every resource (EmailInbox, PhoneInbox, ApiKey, Webhook, EmailMessage) is scoped to an `Organization` via `organizationId`, and a user accesses orgs through `Membership`. Auth-loaded user always has `memberships` with org included. Two scoping patterns coexist in the route handlers — match the existing pattern when extending:

- **User-scoped**: `where: { userId: user.id }` then verify `memberships.find(m => m.organizationId === body.organizationId)` before writing (e.g. `app/api/v1/apiKeys/route.ts`, `emailInbox/route.ts`).
- **Org-scoped**: `where: { organizationId: { in: user.memberships.map(m => m.organizationId) } }` (e.g. `app/api/webhooks/route.ts`).

### API Key security architecture

API keys use **SHA-256 hashing** with scopes for fine-grained access control:

- **Storage**: `apiKey` field stores `null` (never store raw key); `keyHash` stores SHA-256 hash; `prefix` stores first 12 chars of raw key for display
- **Creation** (`POST /api/v1/apiKeys`): Returns full `sk_live_*` prefixed key exactly once — user must copy/save it immediately
- **Listing** (`GET /api/v1/apiKeys`): Returns serialized response via `serializeApiKey()` which exposes only `prefix` (12-char identifier) and `scopes`, never the raw key or hash
- **Scopes**: Fine-grained permissions like `inboxes:read`, `messages:read` — validate against `API_KEY_SCOPE_SET` on creation
- **Validation**: Incoming requests validated via `lib/api-key-scopes.ts` (scope matching) and `lib/api-key-security.ts` (HMAC validation)

### Email ingestion (Resend webhook)

`app/api/v1/webhooks/email/route.ts` receives `email.received` events from Resend.
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
