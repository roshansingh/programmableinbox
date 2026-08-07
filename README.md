# ProgrammableInbox

A Next.js 16 full-stack application for email ingestion, message threading, and automation execution. Ships as open-source with an optional SaaS billing plugin.

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+ (optional, only for async webhook processing)

### Development Setup

```bash
# Install dependencies
npm install

# Create .env from template and fill in values
cp .env.example .env

# Set up database
npx prisma migrate dev
npx prisma db seed  # Creates test@example.com / password123

# Start dev server
npm run dev
# Runs on http://localhost:4000
```

### Login

- **Email**: test@example.com
- **Password**: password123

---

## Async Webhook Processing

ProgrammableInbox supports **asynchronous email ingestion** via a BullMQ-backed job queue. This allows webhook responses to return in 50-100ms without blocking on email storage or automation dispatch.

### Default Behavior (Sync Mode)

By default, async processing is **disabled**:

```bash
# .env (default)
ENABLE_ASYNC_WEBHOOK_PROCESSING=false
```

Webhooks process synchronously: Resend → validate signature → fetch email → store in DB → dispatch automations → return response. No Redis needed.

**Pros**: Simple, no additional service required  
**Cons**: Webhook response slower (~500ms-2s), dependent on DB performance

### Enable Async Mode (with Redis)

To use the async queue:

```bash
# .env
ENABLE_ASYNC_WEBHOOK_PROCESSING=true
REDIS_URL=redis://localhost:6379
WEBHOOK_QUEUE_MAX_RETRIES=3
WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=5
```

Then start Redis:

```bash
# Option 1: Local Redis
redis-server

# Option 2: Docker
docker run -d -p 6379:6379 redis:latest
```

Restart the dev server. The worker will auto-start on the first webhook or health check:

```bash
curl http://localhost:4000/api/internal/webhook-worker/health
```

**Pros**: Fast webhook response, durable (jobs retried on failure)  
**Cons**: Requires Redis, more infrastructure

### Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `ENABLE_ASYNC_WEBHOOK_PROCESSING` | `false` | Enable/disable async mode |
| `REDIS_URL` | *(none — required when async is on)* | Redis connection URL |
| `WEBHOOK_QUEUE_MAX_RETRIES` | `3` | Max retries before dead-letter |
| `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` | `5` | Parallel jobs |

See `.env.example` for detailed descriptions.

### Monitoring (Async Mode)

```bash
# Health check
curl http://localhost:4000/api/internal/webhook-worker/health

# Queue depth (how many jobs waiting)
redis-cli XLEN email-webhook-jobs

# Dead-letter queue (failed jobs)
redis-cli LLEN email-webhook-dlq
```

For production deployment details, see `docs/async-webhook-processing-operator-guide.md`.

---

## MCP Server (agent access)

`POST /api/mcp` exposes the read-only email surface over the [Model Context Protocol](https://modelcontextprotocol.io), so an agent client — Claude Code, Claude Desktop, Cursor, VS Code — can read inboxes and messages with an API key you already have.

It is **read-only by construction**, not by policy: mutating services require an owner scope that an API key cannot produce, so no prompt-injected model can send mail, rename an inbox, or delete anything through it.

### 1. Enable it on the server

Off by default. While off the endpoint returns `404`, so an instance that does not want it does not advertise it.

```bash
# .env
ENABLE_MCP=true
```

Restart the server — config is parsed once per process, so a running instance will not pick this up.

### 2. Create an API key

In the dashboard, go to **API Keys → Create**, and grant:

| Scope | Needed for |
|---|---|
| `email_inboxes:read` | listing inboxes |
| `email_messages:read` | listing, searching, reading messages, and OTP |
| `email_inboxes:create` | claiming new inbox addresses |
| `email_inboxes:update` | renaming inboxes |
| `email_inboxes:delete` | deleting inboxes |

The three mutating scopes are separate grants, and none is granted by default.
They are split rather than bundled into one `write` because they do not cost
the same to get wrong: creating and renaming are recoverable, while
**deleting retires the address permanently**. The inbox and its messages are
soft-deleted and the data survives, but the address stays claimed forever —
mail keeps being delivered to it, so releasing it would hand the next claimant
your still-arriving messages. There is no way to undo that, including for you.

Grant `email_inboxes:delete` only where something genuinely needs it.

The full `sk_live_…` key is shown **once, at creation**. Copy it then; only its 12-character prefix is retrievable afterwards.

### 3. Connect a client

The endpoint is `https://<your-host>/api/mcp` (locally, `http://localhost:4000/api/mcp`). Authentication is a standard bearer header.

**Claude Code**

```bash
claude mcp add --transport http programmableinbox https://<your-host>/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

Add `--scope user` to make it available in every project rather than just the current one. Verify with `claude mcp list`, and use `/mcp` inside a session to see the tools.

**Cursor** — `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "programmableinbox": {
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer ${env:PIBX_API_KEY}" }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "programmableinbox": {
      "type": "http",
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer ${env:PIBX_API_KEY}" }
    }
  }
}
```

**Claude Desktop / claude.ai** — add it as a custom connector pointing at the same URL. Sending a static `Authorization` header is a gated feature there and the credential is shared with everyone in the workspace, so prefer a key minted for that purpose. Client config formats change; check your client's current MCP docs if a key here stops being honored.

Keep the key in an environment variable rather than inline where the client supports it (`${env:PIBX_API_KEY}` above) — these config files are easy to commit by accident.

### Tools

All are prefixed `pibx_email_`. The six read tools are annotated read-only;
the two write tools are not, so clients can prompt for confirmation on them.

| Tool | Scope | What it does |
|---|---|---|
| `pibx_email_list_inboxes` | `email_inboxes:read` | Lists inboxes the key can read. Start here — every other tool takes an `inboxId` |
| `pibx_email_list_messages` | `email_messages:read` | Messages newest first, snippet per message. Supports `threadId`, `grouped`, `cursor` |
| `pibx_email_search_messages` | `email_messages:read` | Filters by `q` (subject + body), `from`, `tags`, `categories` |
| `pibx_email_get_message` | `email_messages:read` | One message with its full plain-text body |
| `pibx_email_get_thread` | `email_messages:read` | A whole conversation, oldest first, in one call |
| `pibx_email_get_latest_otp` | `email_messages:read` | The most recent one-time code, with the message it came from |
| `pibx_email_create_inbox` | `email_inboxes:create` | Claims a new address and returns the inbox |
| `pibx_email_update_inbox` | `email_inboxes:update` | Renames an inbox. The address itself cannot be changed |

**There is no delete tool, deliberately** — even for a key holding
`email_inboxes:delete`. `DELETE /api/v1/emailInbox/{id}` exists for that; MCP
does not, because a tool call can be chosen by a model reading an
attacker-controlled message body, and deleting an inbox is the one operation
here that no follow-up call can undo.

Things worth knowing when a search comes back empty:

- **Search filters, it does not rank.** There is no relevance ordering to ask for, and results use the same cursor as listing.
- `q` searches the subject and body, **not** the sender — that is what `from` is for.
- `tags` and `categories` are **exact** matches, so a near-miss value returns nothing rather than something close.
- Common English stop words match nothing on their own; a query of only words like `the is` returns no rows.
- Messages that arrived HTML-only before body indexing shipped are findable by subject but not by body.
- `pibx_email_get_latest_otp` only returns codes from the **last 15 minutes** by default, because a stale code looks identical to a fresh one and fails wherever it is pasted. Widen it with `withinMinutes`.

Responses default to snippets, not full bodies, and HTML is never returned at any verbosity — a handful of HTML emails would otherwise exhaust a client's tool-result budget in one call. Ask for a full body with `pibx_email_get_message`, or `response_format: "detailed"`.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_MCP` | `false` | Off means the route 404s |
| `MCP_ALLOWED_ORIGINS` | empty | Browser origins allowed to call the endpoint, e.g. `https://app.example.com` |
| `MCP_RATE_LIMIT_MAX` | `120` | Requests per window, per API key |
| `MCP_RATE_LIMIT_WINDOW_S` | `60` | Window length in seconds |

`MCP_ALLOWED_ORIGINS` is a DNS-rebinding defense required by the transport spec. A request carrying **no** `Origin` header is allowed — every client above is a native or server-side caller that sends none — while a request carrying one that is not on the list is refused. Leave it empty unless a browser application genuinely needs the endpoint.

Each entry must be a full origin **including the scheme** — `https://app.example.com`, not `app.example.com`. Anything that is not a comparable origin (a bare host, a `host:port`, or a scheme like `chrome-extension://` that has no well-defined origin) fails at boot naming the variable, rather than being dropped and then refusing every request it was written to admit.

Rate limiting shares the auth limiter, so it is subject to `AUTH_RATE_LIMIT_ENABLED` and needs `REDIS_URL` when that is on.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `404` | `ENABLE_MCP` is not `true`, or the server has not been restarted since it was set |
| `401` | Missing/typo'd key, a revoked or expired key, or a JWT sent instead of an `sk_live_` key |
| `403 Origin not allowed` | The client sent an `Origin` header not in `MCP_ALLOWED_ORIGINS` |
| `429` | Per-key budget spent; `Retry-After` says how long to wait |
| Tool reports a missing scope | The key lacks the scope that tool needs — see the table above. Scopes are fixed at creation, so mint a new key rather than trying to edit one |
| Missing-scope error names a scope you thought you had | Keys created before the rename hold `inboxes:read` / `messages:read`. Those are still accepted, and the error reports the current name; the migration rewrites them |
| "Provide at least one of q, from, tags or categories" | `pibx_email_search_messages` was called with no filter. Use `pibx_email_list_messages` to page without filtering |
| "No inbox with id … is available to this API key" | The inbox belongs to another organization, or does not exist — the message is the same either way. `pibx_email_list_inboxes` shows what the key can reach |

---

## Commands

```bash
npm run dev          # Start dev server (port 4000)
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Run ESLint
npm run test         # Run tests once
npm run test:watch   # Run tests in watch mode

# Database
npx prisma migrate dev      # Apply migrations
npx prisma db seed          # Seed test data
npx prisma studio          # Open Prisma Studio (GUI)

# Single test
npx vitest run components/__tests__/emails-list.test.tsx
```

---

## Architecture

- **Frontend & API**: Same Next.js app (no separate backend)
- **Auth**: JWT tokens stored in localStorage, validated per-route
- **Database**: PostgreSQL with Prisma 7 ORM
- **Email Ingestion**: Resend webhooks → optional async processing via BullMQ
- **Billing Plugin**: Optional separate repo, hooked via `lib/plugins.ts`

### Key Files

- `app/` — Next.js App Router (pages + API routes)
- `lib/` — Shared utilities (auth, DB, API client, automations)
- `components/` — React components
- `prisma/` — Database schema + migrations
- `docs/` — Operator guides and architecture docs
- `debates/` — Design decision records (ADRs)

---

## Testing

Tests use Vitest + MSW (Mock Service Worker) + jsdom:

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# Single file
npx vitest run components/__tests__/emails-list.test.tsx
```

MSW intercepts all fetch calls. Every API call in a test must have a handler in `test/mocks/handlers.ts` or be overridden per-test.

---

## Environment Variables

Every variable is read and validated in one place, `lib/config/`, against a zod schema. `assertConfig()` runs at server boot and reports **all** misconfigured variables at once. A value that is set but malformed is rejected rather than replaced by a default — a typo'd tuning value stops the server instead of being silently ignored. A blank value (`FOO=`) counts as unset. Booleans accept `true/1/yes/on` and `false/0/no/off`, case-insensitively.

Required:

- `DATABASE_URL` — PostgreSQL connection string. Must carry `options=-c%20timezone%3DUTC`; this is enforced
- `JWT_SECRET` — Secret key for JWT signing. At least 16 characters; generate with `openssl rand -base64 32`
- `AUTH_RESEND_API_KEY` — Resend API key for email sending/receiving
- `WEBHOOK_SECRET` — Secret for validating Resend webhook signatures
- `AUTH_EMAIL_FROM` — Sender email address
- `AUTH_EMAIL_FROM_NAME` — Sender display name

Optional:

- `NEXT_PUBLIC_API_MODE` — `local` (same-origin) or `external`. Validated but currently informational: the client always builds a same-origin base URL
- `ENABLE_ASYNC_WEBHOOK_PROCESSING` — `true` for async, `false` for sync (default `false`)
- `REDIS_URL` — Redis connection. **No default.** Required when `ENABLE_ASYNC_WEBHOOK_PROCESSING=true`, and the server refuses to start without it; a localhost fallback would silently connect to the wrong Redis, or none
- `WEBHOOK_QUEUE_MAX_RETRIES` — Job retry count (default `3`)
- `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` — Parallel jobs (default `5`)
- `LOG_LEVEL` — `trace`…`silent`; unset means `debug` in development, `info` in production
- `HEALTHZ_SECRET` — Unlocks backup detail on `/api/healthz`
- `AUTOMATION_SWEEPER_SECRET` — Required by `POST /api/cron/sweep-stuck-runs`
- `WEBHOOK_EGRESS_ALLOWLIST` — Comma-separated egress allowlist for tenant-controlled webhook URLs
- `WEBHOOK_ALLOW_PRIVATE_NETWORK` — Dev-only escape hatch; ignored in production
- `ENABLE_BILLING` — Commercial layer (default `false`)
- `ENABLE_MCP` — MCP server at `POST /api/mcp` (default `false`; the route 404s while off). See [MCP Server](#mcp-server-agent-access)
- `MCP_ALLOWED_ORIGINS` — Comma-separated browser origins allowed to call `/api/mcp`, each including its scheme. Empty by default, which refuses any request carrying an `Origin` header; a malformed entry fails at boot
- `MCP_RATE_LIMIT_MAX` / `MCP_RATE_LIMIT_WINDOW_S` — Per-API-key budget for `/api/mcp` (defaults `120` per `60` seconds)
- `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` — Enrichment. Setting a provider requires an API key, except for `ollama`

See `.env.example` for details — a test fails if it drifts from the schema.

---

## Known Issues

- `app/phones/[id]/page.tsx` and `app/phones/page.tsx` have pre-existing TypeScript errors (MobileSidebarProps). Don't fix as drive-by.

---

## Plugin Architecture

The app supports optional SaaS billing via a plugin system. See `lib/plugins.ts` for the contract. Plugins are loaded lazily via the `INBOXUI_PLUGIN_MODULE` environment variable and can enforce quotas on:

- Automation count per organization
- Email processing count per organization
- Inbox count per organization (optional)

OSS core has no billing dependencies. Billing plugin is maintained separately.

---

## Support

- **Architecture decisions**: See `debates/` directory (ADRs)
- **Operator guide**: `docs/async-webhook-processing-operator-guide.md`
- **Prisma schema**: `prisma/schema.prisma`
- **API client**: `lib/api-client.ts`
- **Auth server**: `lib/auth-server.ts`
