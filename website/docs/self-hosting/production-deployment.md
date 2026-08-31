---
sidebar_position: 3
title: Production Deployment
---

# Production Deployment

The reference production setup runs the app behind
[Caddy](https://caddyserver.com/) as the sole public-facing ingress, with
PostgreSQL and (optionally) Redis as internal-only services — nothing but
Caddy is exposed on ports 80/443.

## What Caddy does

- Terminates TLS automatically via Let's Encrypt (configured with an admin
  contact email for certificate notices).
- Reverse-proxies all traffic to the app container.
- Adds security headers on every response: HSTS, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## Bring the stack up

The compose files and configuration live under `deploy/` in the repository.
Clone the repo, `cd deploy`, and follow the
[operator's guide](https://github.com/roshansingh/programmableinbox/blob/main/deploy/README.md)
to provision secrets and environment files before running the commands below.

```bash
docker compose pull
docker compose up -d postgres
docker compose run --rm migrate
docker compose up -d
```

The `migrate` step runs schema migrations using a dedicated
`inboxui_migrator` database role with DDL privileges. The app
itself connects as `inboxui_app`, which can only read and write
data — it cannot alter the schema. A third role,
`inboxui_backup`, can read everything plus write backup status,
for use by backup tooling. A break-glass superuser role exists but is never
used by the running application.

## DNS and health check

Point your domain's `A` record at the host, then verify:

```bash
curl -fsS https://your-domain.example.com/api/healthz
```

## Next step

See [Upgrading](upgrading) for how to roll out a new version safely.
