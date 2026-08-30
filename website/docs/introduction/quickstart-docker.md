---
sidebar_position: 3
title: Quickstart (Docker)
---

# Quickstart (Docker)

The fastest way to run ProgrammableInbox locally is with the published
Docker image and compose file — no local Node.js or PostgreSQL install
required.

```bash
mkdir programmableinbox && cd programmableinbox
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/.env.quickstart.example
cp .env.quickstart.example .env
```

Edit `.env` and set at minimum:

- `POSTGRES_PASSWORD` — any value
- `JWT_SECRET` — generate with `openssl rand -base64 32`
- `WEBHOOK_SECRET` — any string, 8+ characters
- `AUTH_RESEND_API_KEY=re_placeholder` — a real [Resend](https://resend.com)
  key is only needed to receive real mail
- `EMAIL_INBOX_DOMAINS=inbox.example.com` — the domain(s) inboxes may be
  created on

Then start it:

```bash
docker compose pull
docker compose up -d
docker compose logs -f app
```

Open [http://localhost:4000](http://localhost:4000) and register a new
account at `/auth/register` — this image ships with no seed data, unlike a
from-source checkout.

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Pin to a specific release instead of always taking the latest by setting
`IMAGE_TAG=vX.Y.Z` in `.env` before pulling.

## Stopping

```bash
docker compose down       # stops containers, keeps data volumes
docker compose down -v    # stops containers and deletes data volumes
```

## Next steps

- Building from source instead, or deploying to production? See
  [Self-Hosting](../self-hosting/requirements-and-installation).
- Ready to call the API? See [Authentication & Scopes](../api-reference/authentication-and-scopes).
