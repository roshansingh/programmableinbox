# Architecture

This is the map of how ProgrammableInbox is put together. Start here, then follow the links
below into whichever area you're touching. Each doc is self-contained — you shouldn't need to
read all of them to make one change, but each will point at the others where the boundaries
matter.

If you're a new human or agent contributor, read this page, skim the [request flow](#request-flow)
section below, then jump straight to the doc for the area you're changing.

## The shape of the app

ProgrammableInbox is a **Next.js 16 App Router** app that is both the frontend and the API —
there is no separate backend service. UI pages and `/api/*` route handlers live in the same
`app/` tree and deploy together.

| Layer | Where |
|---|---|
| Frontend & API routes | `app/` (Next.js App Router) |
| Shared logic (auth, config, services, integrations) | `lib/` |
| React components | `components/` |
| Database schema + migrations | `prisma/` |
| Tests | colocated `__tests__/` directories, plus `test/` for shared fixtures/mocks |
| Reserved for future commercial code | `ee/` — see [commercial-layer.md](commercial-layer.md) |

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma 7 + PostgreSQL, Tailwind CSS 4
+ shadcn/ui, Vitest + MSW for testing, Pino for logging, BullMQ + Redis for optional async job
processing.

## Request flow

```
Browser → lib/api-client.ts → /api/app/... route handler → auth wrapper → service layer → Prisma → PostgreSQL
```

- The client base URL is built at runtime as `window.location.origin + '/api'` — there's no
  separate API host to configure.
- Every route handler is wrapped in one of three auth wrappers (`withUser`, `withApiKey`,
  `withPublic`) before it runs. See [auth.md](auth.md).
- Every response is `{ data: ... }` on success or `{ message: ... }` on error — see
  [Response envelope](#response-envelope) below.
- Handlers never query the database directly with a raw user/organization id. They convert
  whatever they're given into a scope object first — see
  [multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md).

### Response envelope

All routes use the helpers in `lib/api-helpers.ts`:

- `jsonSuccess(data, status)` → `{ data }`
- `jsonError(message, status)` → `{ message }`

`lib/api-client.ts` unwraps `data.data` automatically on the client side. **A route that returns
a bare object instead of using `jsonSuccess` will silently hand the client the wrong shape** —
always use the helper.

### The four route trees

| Tree | Wrapper | Contents |
|---|---|---|
| `app/api/v1/**` | `withApiKey` | The published external API |
| `app/api/app/**` | `withUser` (`withPublic` for auth/login, auth/register, verification, password reset) | Everything the dashboard calls |
| `app/api/webhooks/**` | `withPublic` | Provider ingest, authenticated by HMAC rather than by caller |
| `app/api/mcp` | `withApiKey({ scopes: [] })` | The [MCP server](mcp-server.md) — one POST, scopes enforced per tool |

A structural test (`lib/__tests__/route-guards.test.ts`) imports every route module and checks a
non-enumerable symbol the wrappers attach, so "was this route wrapped, and with what" is
verified rather than assumed.

## Where to go next

| Doc | Covers |
|---|---|
| [auth.md](auth.md) | JWT sessions, the three auth wrappers, API keys vs. user sessions, route trees |
| [multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md) | Organizations, scopes, API key scopes and security model |
| [rate-limiting-and-account-security.md](rate-limiting-and-account-security.md) | Login/register rate limiting, lockout, email verification, password reset |
| [email-ingestion-and-search.md](email-ingestion-and-search.md) | Resend webhook ingestion, threading, full-text message search |
| [async-webhook-processing.md](async-webhook-processing.md) | The optional BullMQ/Redis async ingestion path |
| [mcp-server.md](mcp-server.md) | The Model Context Protocol server for agent clients |
| [commercial-layer.md](commercial-layer.md) | The `lib/commercial/` seam and the open-core (`ee/`) model |
| [configuration.md](configuration.md) | `lib/config/`, environment variables, Prisma 7 and Next.js 16 specifics |
| [testing.md](testing.md) | Vitest + MSW setup, integration tests against real Postgres |

For day-to-day commands (dev server, tests, migrations), see the root [README](../../README.md).
For an operator's guide to running this in production, see
[`docs/async-webhook-processing-operator-guide.md`](../async-webhook-processing-operator-guide.md)
and [`docs/logging.md`](../logging.md).
