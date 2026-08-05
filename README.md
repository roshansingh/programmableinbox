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
