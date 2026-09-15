---
sidebar_position: 2
title: Quickstart (Docker)
---

# Quickstart (Docker)

Self-hosting gets you a programmable inbox running on your own
infrastructure. Most people are better served by the hosted version at
[app.programmableinbox.com](https://app.programmableinbox.com) — no server to
run, no upgrades to manage. Self-host if you specifically want your mail to
never leave infrastructure you control.

This walks through the published Community Edition Docker image — no Node,
no local Postgres install, no build step. It spins up the app, a database,
and Redis with Docker Compose. Building from source isn't covered here;
Docker is the supported way to self-host.

## Minimum requirements

See [Requirements](requirements) for the full picture. In short: 1 vCPU /
2 GB RAM is enough to try it, Docker Engine with the Compose plugin is the
only software prerequisite, and a Resend account is needed once you want to
receive real mail (step 5 below).

## 1. Get the Compose file and env template

```bash
mkdir programmableinbox && cd programmableinbox
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/.env.quickstart.example
cp .env.quickstart.example .env
```

(Already have the repo cloned? Both files are at its root — just `cp
.env.quickstart.example .env` there instead.)

## 2. Configure `.env` {#configure-env}

A [Resend](https://resend.com) account is required to actually use the
product — see [Requirements → External services](requirements#external-services)
for the create-account/verify-domain/set-up-webhook steps and where the two
Resend values below come from. Open `.env` and fill in the values with no
default:

```bash
# a URL-safe password for the local Postgres container (avoid `/`, `@`, `:`); e.g. openssl rand -hex 24
POSTGRES_PASSWORD=<generated password>

# openssl rand -base64 32
AUTH_JWT_SECRET=<generated secret>

# any 8+ character string is enough to boot
RESEND_WEBHOOK_SECRET=<any string>

# a placeholder is fine for now — see step 5 to use a real one
RESEND_API_KEY=re_placeholder

# a domain you don't control yet is fine for exploring the UI —
# see step 5 to receive real mail
EMAIL_INBOX_ALLOWED_DOMAINS=inbox.example.com
```

`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `EMAIL_INBOX_ALLOWED_DOMAINS`
are validated for *shape* only at startup, not checked against Resend — a
placeholder boots the app fine. You'll need real values before any inbox can
actually receive mail (step 5).

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
domain you set in `EMAIL_INBOX_ALLOWED_DOMAINS`). You can then use the
[REST API](../api-reference/authentication-and-scopes) or an
[SDK](../sdks/overview) with an API key; to use MCP, see
[Enabling MCP on a self-hosted instance](../mcp/setup#self-hosted) below.

## 5. Receive real mail (optional)

To have this instance actually receive email:

1. Add and verify a domain in your [Resend](https://resend.com) account.
2. Create a webhook for the `email.received` event, pointed at
   `https://<your-host>/api/webhooks/email` (this means the app needs to be
   reachable from the internet — see [Add TLS with Caddy](#add-tls) below
   for a way to do that), then copy the webhook's **signing secret** —
   you'll need it in the next step.
3. Set `RESEND_API_KEY` to your real Resend API key, `RESEND_WEBHOOK_SECRET`
   to the signing secret from step 2, and `EMAIL_INBOX_ALLOWED_DOMAINS` to
   that verified domain in `.env`. A webhook whose signature doesn't match
   `RESEND_WEBHOOK_SECRET` is rejected, so this step isn't optional once
   you've set up a real webhook.
4. `docker compose up -d` to pick up the change.

Until then, everything else — the dashboard, the API, and MCP tools — works
against inboxes on the placeholder domain. Outbound sends (the
[send endpoint](../api-reference/authentication-and-scopes), password-reset
and verification emails) call Resend directly and fail with a placeholder
`RESEND_API_KEY`, so those need a real key even before you set up inbound
mail.

## Add TLS with Caddy {#add-tls}

The setup above is a local trial: no TLS, and `app` is only reachable at
`localhost:4000`. To reach it from the internet — needed for step 5, or for
any real usage — put a TLS-terminating reverse proxy in front of it.
[Caddy](https://caddyserver.com/) is a low-effort option: point it at the
`app` service and it handles Let's Encrypt certificates automatically.

Add a `Caddyfile` next to `docker-compose.yml`:

```
your-domain.example.com {
	reverse_proxy app:4000
}
```

Add a `caddy` service to the same `docker-compose.yml` from step 1:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      - app
```

and add `caddy-data:` alongside `postgres-data:`/`redis-data:` under the
top-level `volumes:` key. Bring it up the same way as before:

```bash
docker compose up -d
```

Point your domain's `A` record at the host, then verify:

```bash
curl -fsS https://your-domain.example.com/api/healthz
```

That's as far as this guide goes on exposing the app publicly. **Now that
Caddy is the ingress, remove `app`'s `ports: - "${APP_PORT:-4000}:4000"`
mapping** — left in place, it publishes the app on every host interface over
plain HTTP, which is a direct bypass around Caddy's TLS on anything but a
local-only trial. Keep it only if `app` is meant to stay reachable at
`localhost:4000` and nowhere else.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Pulls the new image and re-runs `prisma migrate deploy` against your existing
database before restarting. To pin a specific release instead of the mutable
`:latest` tag, set `IMAGE_TAG=vX.Y.Z` in `.env` — see
[Releases on GitHub](https://github.com/roshansingh/programmableinbox/releases)
for available tags. Images are multi-arch (`linux/amd64`, `linux/arm64`). See
[Upgrading](upgrading) for the full rollout and rollback notes.

## Stopping / data

```bash
docker compose down        # stop containers, keep data
docker compose down -v     # stop containers and delete the Postgres/Redis volumes
```

Postgres and Redis data live in the named volumes `postgres-data` and
`redis-data`, so `docker compose down` alone is safe to run between sessions.
If you've added the `caddy` service from [Add TLS with Caddy](#add-tls),
`-v` also deletes `caddy-data` — Caddy's issued TLS certificates and state,
not just Postgres/Redis — so avoid it on a deployment you're keeping.

## Troubleshooting

- **`app` exits immediately, logs mention a missing/invalid env var** — the
  app validates every required variable at boot and refuses to start if one
  is unset or malformed (see [Configuration](configuration)). The error
  names the offending variable.
- **`app` can't reach `postgres`/`redis`** — both have healthchecks and `app`
  waits on them; give the stack a few seconds after `docker compose up -d` and
  recheck with `docker compose ps`.
- **Changed `.env` but nothing changed** — environment values are read at
  container start, not live-reloaded: `docker compose up -d` after any edit.

## Next steps

- Ready to call the API? See [Authentication & Scopes](../api-reference/authentication-and-scopes).
- Wiring up an agent? See [MCP Setup](../mcp/setup).
