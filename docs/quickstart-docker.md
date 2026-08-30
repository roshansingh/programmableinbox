# Quick start: Community Edition via Docker

The fastest way to try ProgrammableInbox is the published Community Edition
Docker image — no Node, no local Postgres install, no build step. This spins
up the app, a database, and Redis on your machine.

This is a **local trial setup**, not a production deployment: one Postgres
role, no TLS, no backups. For running this in production, see
[`deploy/README.md`](../deploy/README.md) instead.

If you'd rather run from source (for development, or to use `npx prisma db
seed`'s test account), see the [Quick start](../README.md#quick-start) in the
main README.

## Prerequisites

- Docker with the Compose plugin (`docker compose version`)

## 1. Get the Compose file and env template

```bash
mkdir programmableinbox && cd programmableinbox
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/.env.quickstart.example
cp .env.quickstart.example .env
```

(Already have the repo cloned? Both files are at its root — just `cp
.env.quickstart.example .env` there instead.)

## 2. Configure `.env`

Open `.env` and fill in the values with no default:

```bash
# a URL-safe password for the local Postgres container (avoid `/`, `@`, `:`); e.g. openssl rand -hex 24
POSTGRES_PASSWORD=<generated password>

# openssl rand -base64 32
JWT_SECRET=<generated secret>

# any 8+ character string is enough to boot
WEBHOOK_SECRET=<any string>

# a placeholder is fine for now — see step 5 to use a real one
AUTH_RESEND_API_KEY=re_placeholder

# a domain you don't control yet is fine for exploring the UI —
# see step 5 to receive real mail
EMAIL_INBOX_DOMAINS=inbox.example.com
```

`AUTH_RESEND_API_KEY` and `EMAIL_INBOX_DOMAINS` are validated for *shape*
only at startup, not checked against Resend — a placeholder boots the app
fine. You'll need real values before any inbox can actually receive mail
(step 5).

## 3. Pull and start

```bash
docker compose pull
docker compose up -d
```

The `app` container runs `prisma migrate deploy` before starting the server,
so the database schema is created automatically on first boot. Watch it come
up with:

```bash
docker compose logs -f app
```

Once healthy, open **http://localhost:4000**.

## 4. Create an account

The Community Edition image doesn't ship seed data — register a new account
directly at `/auth/register`. From there you can create an inbox (on the
domain you set in `EMAIL_INBOX_DOMAINS`). You can then use the [REST
API](../sdk/README.md) with an API key; to use [MCP](architecture/mcp-server.md),
set `ENABLE_MCP=true` in `.env` and restart the stack.

## 5. Receive real mail (optional)

To have this instance actually receive email:

1. Add and verify a domain in your [Resend](https://resend.com) account.
2. Point that domain's inbound route at `https://<your-host>/api/webhooks/email`
   (this means the app needs to be reachable from the internet — see
   [`deploy/README.md`](../deploy/README.md) for a hardened way to do that
   with TLS).
3. Set `AUTH_RESEND_API_KEY` to your real Resend API key and
   `EMAIL_INBOX_DOMAINS` to that verified domain in `.env`.
4. `docker compose up -d` to pick up the change.

Until then, everything else — the dashboard, the API, MCP tools, sending mail
— works against inboxes on the placeholder domain.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Pulls the new image and re-runs `prisma migrate deploy` against your existing
database before restarting. To pin a specific release instead of the mutable
`:latest` tag, set `IMAGE_TAG=vX.Y.Z` in `.env` — see [Releases on
GitHub](https://github.com/roshansingh/programmableinbox/releases) for
available tags. Images are multi-arch (`linux/amd64`, `linux/arm64`).

## Stopping / data

```bash
docker compose down        # stop containers, keep data
docker compose down -v     # stop containers and delete the Postgres/Redis volumes
```

Postgres and Redis data live in the named volumes `postgres-data` and
`redis-data`, so `docker compose down` alone is safe to run between sessions.

## Troubleshooting

- **`app` exits immediately, logs mention a missing/invalid env var** — the
  app validates every required variable at boot and refuses to start if one
  is unset or malformed (see [configuration.md](architecture/configuration.md)).
  The error names the offending variable.
- **`app` can't reach `postgres`/`redis`** — both have healthchecks and `app`
  waits on them; give the stack a few seconds after `docker compose up -d` and
  recheck with `docker compose ps`.
- **Changed `.env` but nothing changed** — environment values are read at
  container start, not live-reloaded: `docker compose up -d` after any edit.
