---
sidebar_position: 2
title: Configuration
---

# Configuration

All configuration is read from environment variables. A misconfigured
deployment fails at boot with a report naming every offending variable,
rather than failing requests one at a time later.

## Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Must include `?options=-c%20timezone%3DUTC` (or `+c+timezone...`) — see the note below. |
| `JWT_SECRET` | Signs session tokens. Generate with `openssl rand -base64 32`. |
| `WEBHOOK_SECRET` | Verifies inbound mail webhooks. |
| `AUTH_RESEND_API_KEY` | [Resend](https://resend.com) API key, used to send auth emails and receive inbound mail. |
| `AUTH_EMAIL_FROM` | From-address for outgoing auth emails. |
| `AUTH_EMAIL_FROM_NAME` | Display name for outgoing auth emails. |
| `EMAIL_INBOX_DOMAINS` | Comma-separated list of domains inboxes may be created on. Each must be verified in Resend with its inbound route pointed at `POST /api/webhooks/email`. |

### The `DATABASE_URL` timezone option

Postgres interprets the naive timestamps Prisma sends using the *session*
timezone. Without an explicit UTC session, a host whose local timezone isn't
UTC stores every timestamp shifted by its offset. This is enforced at boot,
not just documented — a connection string missing the option fails
`assertConfig()`.

## Common optional variables

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | none | Required if `ENABLE_ASYNC_WEBHOOK_PROCESSING=true` or `AUTH_RATE_LIMIT_ENABLED` (on by default) |
| `ENABLE_ASYNC_WEBHOOK_PROCESSING` | `false` | Process inbound mail via a Redis/BullMQ queue instead of inline, for high volume |
| `WEBHOOK_QUEUE_MAX_RETRIES` | `3` | Async webhook job retry limit |
| `AUTH_RATE_LIMIT_ENABLED` | `true` | Rate-limits login/register — see [Rate Limits](../reference/rate-limits) |
| `ENABLE_EMAIL_VERIFICATION` | `false` | Require a verified email before dashboard access (needs `EMAIL_LINK_SECRET` + `APP_BASE_URL` when on) |
| `ENABLE_MCP` | `false` | Expose the MCP server at `/api/mcp` — see [MCP Setup](../mcp/setup) |
| `MCP_ALLOWED_ORIGINS` | (empty) | Comma-separated allowed Origins for the MCP transport — absent Origin is allowed by default, present-and-unknown is refused |
| `USE_COMMERCIAL` | `false` | Enable the optional commercial/billing layer (needs Stripe keys when on) |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Structured log verbosity |

The full, authoritative list — every variable, every default, every
conditional requirement — lives in
[`.env.example`](https://github.com/roshansingh/programmableinbox/blob/main/.env.example)
in the repository; this page covers what most self-hosters actually need to
set.

## Next step

Ready for production? See [Production Deployment](production-deployment).
