# Deployment — operator's guide

Step-by-step guide to stand up **inboxui** on a single OVH box: all services in Docker Compose, self-hosted Postgres with continuous WAL archiving and point-in-time recovery to Backblaze B2, a Redis-backed async webhook worker, Caddy for TLS, and external monitoring via Uptime Kuma on PikaPods.

Design rationale: [`docs/superpowers/specs/2026-07-10-ovh-b2-deployment-revision-design.md`](../docs/superpowers/specs/2026-07-10-ovh-b2-deployment-revision-design.md).

## Architecture at a glance

| Container | Image | Purpose |
|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination + single ingress (80/443), auto Let's Encrypt |
| `app` | `ghcr.io/<owner>/inboxui` | Next.js server on :4000 (intended to host the in-process webhook worker — see Part 8) |
| `migrate` | same as app (profile `migrate`) | One-shot `prisma migrate deploy`, run as the schema-owner role (see [Database roles](#database-roles)) |
| `postgres` | `ghcr.io/<owner>/inboxui-postgres:17` | Database + WAL-G binary, WAL archiving to B2 |
| `redis` | `redis:7-alpine` | BullMQ queue backing async webhook processing |
| `backup-cron` | `ghcr.io/<owner>/inboxui-backup` | Base backups, pg_dump, retention, heartbeats |

External dependencies: **Backblaze B2** (backups), **Uptime Kuma on PikaPods** (monitoring), **GHCR** (images), **Resend** (inbound email webhooks).

> Only Caddy publishes ports to the host. Postgres and Redis are internal-only.

---

## Database roles

The application does **not** connect to Postgres as a superuser. Four roles, with one job each:

| Role | Attributes | What it may do | Who uses it |
|---|---|---|---|
| `$POSTGRES_USER` (bootstrap) | `SUPERUSER` | everything; owns the database | the image entrypoint, and break-glass `docker compose exec` only — **no service connects as it** |
| `inboxui_migrator` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | owns schema `public` and every object in it; `CONNECT` + `CREATE` on the database, so it can run DDL and install *trusted* extensions | the one-shot `migrate` service, via `MIGRATE_DATABASE_URL` |
| `inboxui_app` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | `USAGE` on schema `public`; `SELECT/INSERT/UPDATE/DELETE` on its tables; `USAGE, SELECT` on its sequences | the `app` container, via `DATABASE_URL` |
| `inboxui_backup` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | `pg_read_all_data` (read everything, for `pg_dump`), `pg_read_all_settings`, `pg_read_all_stats`, EXECUTE on the backup-control functions, and write access to `backup_status` — nothing else | `backup-cron`, via `POSTGRES_BACKUP_USER` |

The runtime role cannot `COPY … TO PROGRAM` (host command execution), cannot `pg_read_file`, cannot disable RLS, cannot create roles and cannot drop the database. An SQL-injection or app-level compromise is confined to the data it was already allowed to read and write.

**Why new migrations don't break the app.** Tables created by a future migration are owned by `inboxui_migrator`, and a new table grants nothing to anyone. Without help, the deploy would go green and the app would then throw `permission denied for table <new_table>`. `deploy/postgres/least-privilege-roles.sql` prevents that with:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE inboxui_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inboxui_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inboxui_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO inboxui_app;
```

Default privileges are keyed on the **creating role**, which is the reason migrations must always run as `inboxui_migrator` and never by hand as the superuser. (A duplicate set is registered for the bootstrap role as a safety net if someone does anyway.)

The role model is created automatically by the postgres image's `/docker-entrypoint-initdb.d` hook — but:

> ⚠️ **`/docker-entrypoint-initdb.d` runs only when `PGDATA` is empty.** Deploying this
> image over an existing `/srv/inboxui/pgdata` creates nothing and warns about nothing.
> Converting an already-running cluster is a deliberate operator action:
> `deploy/scripts/pg-apply-least-privilege.sh`, documented step by step in
> [`runbooks/04-postgres-role-rotation.md`](runbooks/04-postgres-role-rotation.md).

`prisma/migrations/…/migration.sql` runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`. pgcrypto is a *trusted* extension on PG13+, so the migrator could install it — but the init SQL installs it as the superuser first, so the statement in the migration is always a no-op. **Any future migration needing an untrusted extension must add it to `deploy/postgres/least-privilege-roles.sql`; it will not work from the `migrate` service.**

---

## Prerequisites — accounts & resources

Set these up before touching the box:

1. **OVH box** — a dedicated/bare-metal server (or Public Cloud instance) running Ubuntu LTS. Note its public IP.
2. **Backblaze B2** — create two buckets and an application key (see Part 4):
   - a WAL-G bucket (physical PITR) with **Object Lock** enabled
   - a restic bucket (logical pg_dump)
3. **Uptime Kuma on PikaPods** — a running Kuma instance; note its URL (e.g. `https://<you>.pikapod.net`).
4. **DNS** — a domain you control, with a low TTL (≤300s) so you can repoint it fast during DR.
5. **GitHub repo + Actions secrets** — `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_PORT` (images push to GHCR using the built-in `GITHUB_TOKEN`).
6. **Resend** — an account for inbound email; you'll point its webhook at this deployment in Part 8.

---

## Part 1 — One-time host bootstrap

SSH in as root and run the bootstrap script:

```bash
git clone https://github.com/OWNER/inboxui /tmp/inboxui
sudo bash /tmp/inboxui/deploy/scripts/bootstrap.sh
```

This installs Docker, creates the non-root `deploy` user (in the `docker` group), creates `/srv/inboxui/{pgdata,redis,backup-logs,secrets}`, and configures `ufw` (22/80/443). Add the OVH Network Firewall with the same rules as a second layer, and set up Tailscale for SSH before dropping public SSH.

---

## Part 2 — Backblaze B2 buckets & keys

1. Create the **WAL-G bucket** and enable **Object Lock** (Governance mode). Set a default retention window shorter than the base-backup retention (e.g. 14 days vs. 30 days of fulls) so pruning never collides with a lock.
2. Create the **restic bucket** (no Object Lock — it conflicts with `restic prune`; use a no-delete key instead).
3. Create an **application key** the host will use (scoped to those buckets, **without** bypass-governance). Keep a second, fully-privileged key **offline in your password manager** for retention maintenance and break-glass recovery.
4. Note the B2 **S3 endpoint** for your region, e.g. `s3.eu-central-003.backblazeb2.com`.

---

## Part 3 — Secrets (`app.env`)

As the `deploy` user, create `/srv/inboxui/secrets/app.env` (mode `0600`). The full key list is in the design spec's §2; the essentials:

```bash
sudo -u deploy install -m 0600 /dev/stdin /srv/inboxui/secrets/app.env <<'EOF'
# App runtime
DOMAIN=inbox.example.com
DATABASE_URL=postgresql://inboxui_app:<app-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
MIGRATE_DATABASE_URL=postgresql://inboxui_migrator:<migrator-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
JWT_SECRET=<random>
WEBHOOK_SECRET=<resend-webhook-hmac>
AUTH_RESEND_API_KEY=
AUTH_EMAIL_FROM=
AUTH_EMAIL_FROM_NAME=
NEXT_PUBLIC_API_MODE=local
HEALTHZ_SECRET=              # optional; gates /api/healthz
# LLM
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=
# Webhook queue / Redis  (async worker not yet wired — see Part 8; keep false for now)
ENABLE_ASYNC_WEBHOOK_PROCESSING=false
REDIS_URL=redis://redis:6379
# Postgres — bootstrap superuser. Created by the image entrypoint; NOTHING
# connects as it (break-glass only). Do not reuse this password anywhere else.
POSTGRES_DB=inboxui
POSTGRES_USER=postgres_admin
POSTGRES_PASSWORD=<superuser-pw>
# Postgres — least-privileged roles (see "Database roles" above). The initdb
# hook reads these to create the roles on a FIRST-TIME init; on an existing
# volume run deploy/scripts/pg-apply-least-privilege.sh instead.
POSTGRES_APP_PASSWORD=<app-pw>            # must match DATABASE_URL
POSTGRES_MIGRATOR_PASSWORD=<migrator-pw>  # must match MIGRATE_DATABASE_URL
POSTGRES_BACKUP_PASSWORD=<backup-pw>
POSTGRES_APP_USER=inboxui_app             # optional, this is the default
POSTGRES_MIGRATOR_USER=inboxui_migrator   # optional, this is the default
POSTGRES_BACKUP_USER=inboxui_backup       # optional, this is the default
# WAL-G → B2
WALG_S3_PREFIX=s3://<walg-bucket>/walg
AWS_ENDPOINT=https://s3.<region>.backblazeb2.com
AWS_ACCESS_KEY_ID=<b2-keyID>
AWS_SECRET_ACCESS_KEY=<b2-appKey>
WALG_COMPRESSION_METHOD=zstd
# restic → B2
RESTIC_REPOSITORY=b2:<pgdump-bucket>:pgdump
B2_ACCOUNT_ID=<b2-keyID>
B2_ACCOUNT_KEY=<b2-appKey>
RESTIC_PASSWORD=<restic-encryption-password>
# Uptime Kuma push (filled in Part 7)
KUMA_PUSH_BASE=https://<you>.pikapod.net
KUMA_TOKEN_WALG_BASE=
KUMA_TOKEN_WALG_WAL=
KUMA_TOKEN_RESTIC_PGDUMP=
EOF
```

The source of truth for this file is your password manager — **never commit it**.

---

## Part 4 — Copy compose files & pick your images

```bash
sudo cp /tmp/inboxui/deploy/docker-compose.yml /srv/inboxui/
sudo cp /tmp/inboxui/deploy/Caddyfile /srv/inboxui/
sudo cp /tmp/inboxui/deploy/scripts/initial_deploy.sh /srv/inboxui/
sudo chown -R deploy:deploy /srv/inboxui/
sudo chmod +x /srv/inboxui/initial_deploy.sh
```

The compose file references `ghcr.io/OWNER/…` images. Point them at your GHCR namespace by creating `/srv/inboxui/.env` (used by compose for variable substitution — distinct from `secrets/app.env`):

```bash
sudo -u deploy tee /srv/inboxui/.env >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/<owner>/inboxui
POSTGRES_IMAGE=ghcr.io/<owner>/inboxui-postgres
BACKUP_IMAGE=ghcr.io/<owner>/inboxui-backup
IMAGE_TAG=latest
POSTGRES_TAG=17
BACKUP_TAG=latest
EOF
```

Images are built and pushed to GHCR by CI on push to `main` (`.github/workflows/deploy.yml`). Trigger one run first so the images exist. If GHCR packages are private, `docker login ghcr.io` on the box with a PAT that has `read:packages`.

---

## Part 5 — First bring-up

Run as the `deploy` user from `/srv/inboxui`:

```bash
docker compose pull

# 1. Database first. On an EMPTY pgdata this also runs the initdb hook that
#    creates inboxui_app / inboxui_migrator / inboxui_backup.
docker compose up -d postgres
docker compose ps            # wait until postgres is "healthy"
docker compose logs postgres | grep '\[inboxui\]'   # confirm the roles were created

# 2. Confirm WAL archiving to B2 works
docker compose exec postgres wal-g backup-list   # should succeed with an empty list

# 3. Run migrations (one-shot; runs as inboxui_migrator via MIGRATE_DATABASE_URL)
docker compose run --rm migrate

# 4. Grant the backup role write access to `backup_status`, which only exists
#    once step 3 has created it. Idempotent; skip it and the backup cron will
#    log "permission denied for table backup_status" every 5 minutes.
sudo cp /tmp/inboxui/deploy/scripts/pg-apply-least-privilege.sh /srv/inboxui/
sudo chown deploy:deploy /srv/inboxui/pg-apply-least-privilege.sh
sudo chmod +x /srv/inboxui/pg-apply-least-privilege.sh
/srv/inboxui/pg-apply-least-privilege.sh

# 5. Bring up the rest
docker compose up -d         # app, caddy, redis, backup-cron

# 6. Force a first base backup
docker compose exec backup-cron /scripts/base-backup.sh
```

> If `pgdata` was **not** empty in step 1 — e.g. you are adopting an existing
> database — none of the roles were created and step 3 will fail on the missing
> `MIGRATE_DATABASE_URL` target. Follow
> [`runbooks/04-postgres-role-rotation.md`](runbooks/04-postgres-role-rotation.md) instead.

---

## Part 6 — DNS & the application

1. Point the `${DOMAIN}` **A record** at the box's public IP. Caddy will obtain a Let's Encrypt cert automatically on first request.
2. Verify TLS + health:
   ```bash
   curl -fsS https://$DOMAIN/api/healthz | jq
   ```
   Expect `200` with `db: ok` and `freshness_breach: false`.
3. **Create the first account**: open `https://$DOMAIN` and register through the auth screen. (For a throwaway test login instead, `docker compose run --rm migrate npx prisma db seed` creates `test@example.com` / `password123`.)

---

## Part 7 — Monitoring (Uptime Kuma on PikaPods)

In your PikaPods Kuma instance:

1. **HTTP monitor** — `https://$DOMAIN/api/healthz`, 60s interval, alert on non-200 for 2 consecutive checks.
2. **Push monitors** (dead-man's-switch) — create three: `walg-base` (26h), `walg-wal` (10min), `restic-pgdump` (26h). Copy each push token into the matching `KUMA_TOKEN_*` in `app.env`, then restart the backup container so it emits heartbeats:
   ```bash
   docker compose up -d backup-cron
   ```
3. Configure an alert channel (Discord/email/Slack) in Kuma's UI.

---

## Part 8 — Wire up inbound email (Resend)

Point your Resend inbound webhook at:

```
https://$DOMAIN/api/webhooks/email
```

Use the same HMAC secret you set as `WEBHOOK_SECRET`.

> The previous path, `/api/v1/webhooks/email`, still works as a temporary alias
> so existing Resend configurations keep delivering. It is removed once the
> dashboard is repointed at the URL above — update it at your earliest
> convenience.

**Webhook processing has two modes, set by `ENABLE_ASYNC_WEBHOOK_PROCESSING`:**

- **`false` (recommended for now)** — mail is stored synchronously in the request. No Redis or worker needed; the `redis` service can stay up but idle. This is the reliable path today.
- **`true` (async)** — the webhook enqueues to Redis and a BullMQ worker processes jobs. ⚠️ **The worker is not currently started by the app** (`lib/instrumentation.ts` is not at the Next.js root and the referenced `WebhookWorkerInit` layout component does not exist), so jobs would queue but never run. Do **not** enable async until the worker startup is wired (add a root `instrumentation.ts`, or a separate worker container).

When async is correctly wired, verify with:

```bash
curl -fsS https://$DOMAIN/api/internal/webhook-worker/health   # expect 200 / worker: running
```

(With async disabled this endpoint returns 503 by design.)

---

## Day-to-day deploys

Pushing to `main` runs CI (lint + test + build) and, on green, SSHes to the box and runs the deploy steps inlined in `.github/workflows/deploy.yml`: it syncs the compose file, pulls `app`+`migrate`, runs `migrate`, rolls `app` + `caddy` behind a healthcheck gate (`--no-deps`, so postgres/redis are untouched), and prunes old images. No manual step.

**Rollback** to a known-good image (uses the manual `initial_deploy.sh`, kept in sync on the box by CI):

```bash
IMAGE_TAG=<previous-sha> /srv/inboxui/initial_deploy.sh <previous-sha>
```

---

## Backups & disaster recovery

Backups run in `backup-cron`: WAL archiving continuously, a full base backup daily, a restic `pg_dump` daily, and a weekly retention sweep — all to Backblaze B2. `/api/healthz` reports freshness from the `backup_status` table.

Runbooks (version-controlled, in `runbooks/`):

- `01-app-crash.md` — app down / bad deploy (rollback)
- `02-db-corruption.md` — point-in-time recovery into a sibling instance
- `03-total-host-loss.md` — rebuild on a new box from B2
- `04-postgres-role-rotation.md` — move an existing cluster onto the least-privileged roles (and rotate their passwords)

**DR drills** (log each to `runbooks/drill-log.md`):

- **Monthly** — restore latest base + a few hours of WAL into a throwaway volume; verify row counts.
- **Quarterly** — full host-loss drill on a temporary box; run runbook 03 end-to-end.
- **Annually** — logical-restore drill from the restic `pg_dump` in B2 with the WAL-G bucket blocked.
