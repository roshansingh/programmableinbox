# Bare-metal Hetzner deployment — design

Status: approved 2026-05-14. Single-server Hetzner deployment of inboxui (Next.js 16 + Prisma 7 + Postgres 17) with WAL-archived, dual-destination backups and a documented disaster recovery plan.

## Goals and non-goals

**Goals**
- One Hetzner bare-metal box running everything in Docker.
- Self-hosted Postgres with continuous WAL archiving.
- Dual off-site backup destinations (one S3-compatible, one Hetzner Storage Box).
- RPO ≤ a few minutes (sub-minute WAL archiving cadence).
- RTO ≤ ~60 minutes for total host loss.
- Open-source only.
- Migrations run safely on every deploy.
- Documented runbooks for three named DR scenarios.
- DR drills are scheduled, not aspirational.

**Non-goals**
- High availability / automated failover. Manual recovery to a fresh box is acceptable.
- Multi-tenant infrastructure or zero-downtime database upgrades.
- Managed-service substitutes (no RDS, no Hetzner managed Postgres).

## Constraints (locked in during brainstorming)

| Constraint | Value |
|---|---|
| Topology | One server, app + db colocated |
| RPO / RTO | Minutes / ~1 hour |
| Backup destinations | Hetzner Storage Box + S3-compatible (different vendor) |
| Orchestration | Docker Compose |
| Deploy flow | GitHub Actions builds → GHCR → SSH-triggered `docker compose pull` |
| Monitoring v1 | Uptime Kuma + healthz + backup-freshness alerts |
| Reverse proxy | Caddy (single domain, auto-HTTPS) |
| Backup engine | WAL-G to S3, restic + rclone to Storage Box (pgBackRest was archived 2026-04-27) |

## 1. System architecture

One Hetzner AX-line bare-metal box (recommended starting size: AX42 — Ryzen 7, 64 GB RAM, 2×512 GB NVMe in software RAID1) running Ubuntu LTS. All services run in Docker via a single `docker-compose.yml` checked into the repo at `deploy/`.

### Containers

| Container | Image | Restart | Purpose |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | `unless-stopped` | TLS termination, single ingress, automatic Let's Encrypt |
| `app` | `ghcr.io/<owner>/inboxui:<sha>` | `unless-stopped` | Next.js standalone server on :4000 |
| `migrate` | same as app | `no` (profile: `migrate`) | One-shot `prisma migrate deploy` |
| `postgres` | `ghcr.io/<owner>/inboxui-postgres:17` (custom — Postgres 17 + WAL-G binary) | `unless-stopped` | Database |
| `backup-cron` | `ghcr.io/<owner>/inboxui-backup:latest` (custom — debian-slim + cron + wal-g + restic + rclone) | `unless-stopped` | Scheduled base backups, pg_dump, rclone mirror, retention, status reporting. Continuous WAL pushes happen inside the `postgres` container via `archive_command`. |
| `uptime-kuma` | `louislam/uptime-kuma:1` | `unless-stopped` | Status checks + alerts |

### Networks

One internal compose network, `inboxui-internal`. Postgres has **no** published port. Only Caddy publishes to the host (80/443). The `backup-cron` container needs network access to Postgres and to outbound HTTPS/SSH for backup destinations.

### Volumes (all bind-mounted under `/srv/inboxui/`)

| Path | Owner | Purpose |
|---|---|---|
| `/srv/inboxui/pgdata` | postgres user (uid 70 in alpine; mapped via compose) | Postgres data directory |
| `/srv/inboxui/pgwal-archive-staging` | postgres user | Local WAL spool between archive_command and wal-push |
| `/srv/inboxui/caddy-data` | caddy uid | ACME certificate cache |
| `/srv/inboxui/caddy-config` | caddy uid | Caddy runtime state |
| `/srv/inboxui/kuma` | uptime-kuma uid | sqlite state |
| `/srv/inboxui/secrets/` | deploy user, mode 0700 | Env files + SSH key for Storage Box |
| `/srv/inboxui/backup-logs/` | backup-cron uid | rotated log output from cron jobs |

### Host-level baseline

- `ufw` firewall: 22 (SSH, key-only), 80, 443. Nothing else open.
- Hetzner Cloud Firewall as a second layer with the same rules.
- Tailscale on the host for SSH; after bootstrap, drop public SSH and require Tailscale.
- `unattended-upgrades` for OS security patches.
- Non-root `deploy` user owns `/srv/inboxui/`; containers run as non-root where the image supports it.
- swap = 0; rely on RAM headroom.
- All hostnames, secrets, and S3 endpoints come from `/srv/inboxui/secrets/app.env` (mode 0600).

## 2. Application layer

### Dockerfile for the app (multi-stage)

```dockerfile
# stage 1: build
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json prisma ./
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# stage 2: runtime
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r nodejs --gid 1001 && useradd -r -g nodejs --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated ./lib/generated
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
USER nextjs
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
```

This requires `output: 'standalone'` in `next.config.mjs` (not currently set — added in implementation).

### Migrations

A separate one-shot container running `npx prisma migrate deploy`. Configured under compose profile `migrate` so it doesn't auto-start. The deploy script runs it with `docker compose run --rm migrate` **before** `docker compose up -d app`. Migrations never run from the app container's entrypoint — that races when multiple app containers start.

### Reverse proxy (Caddy)

Caddyfile:

```
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy app:4000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

`{$DOMAIN}` comes from the app env file. Caddy handles ACME automatically; certs persist in the `caddy-data` volume.

### Secrets

`/srv/inboxui/secrets/app.env` (mode 0600, gitignored, never committed) holds:

```
# App
DOMAIN=
DATABASE_URL=postgresql://app:...@postgres:5432/inboxui
JWT_SECRET=
AUTH_RESEND_API_KEY=
WEBHOOK_SECRET=
AUTH_EMAIL_FROM=
AUTH_EMAIL_FROM_NAME=
NEXT_PUBLIC_API_MODE=local

# Postgres init
POSTGRES_DB=inboxui
POSTGRES_USER=app
POSTGRES_PASSWORD=

# WAL-G / S3
WALG_S3_PREFIX=s3://inboxui-backups/walg
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT=https://...   # B2 or R2 endpoint
WALG_COMPRESSION_METHOD=zstd

# restic → Storage Box (logical dump leg)
RESTIC_REPOSITORY=sftp:u123456@u123456.your-storagebox.de:/restic-pgdump
RESTIC_PASSWORD=

# rclone → Storage Box (mirror of S3 leg)
RCLONE_CONFIG_STORAGEBOX_TYPE=sftp
RCLONE_CONFIG_STORAGEBOX_HOST=u123456.your-storagebox.de
RCLONE_CONFIG_STORAGEBOX_USER=u123456
RCLONE_CONFIG_STORAGEBOX_KEY_FILE=/secrets/storagebox_id_ed25519
```

Plus `/srv/inboxui/secrets/storagebox_id_ed25519` — SSH key for the Storage Box, mode 0600, mounted into the `backup-cron` container at `/secrets/`.

Bootstrap procedure for secrets is documented in `deploy/README.md`; the source of truth is a password manager entry (1Password / Bitwarden — user's choice), not git.

## 3. Postgres and backup pipeline

### Custom Postgres image (`Dockerfile.postgres`)

```dockerfile
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates \
    && wget -q https://github.com/wal-g/wal-g/releases/download/v3.0.7/wal-g-pg-ubuntu-22.04-amd64 \
       -O /usr/local/bin/wal-g \
    && chmod +x /usr/local/bin/wal-g \
    && rm -rf /var/lib/apt/lists/*
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY walg-archive-wrapper.sh /usr/local/bin/walg-archive-wrapper
RUN chmod +x /usr/local/bin/walg-archive-wrapper
```

### `postgresql.conf` (relevant overrides)

```
listen_addresses = '*'
max_connections = 100
shared_buffers = 16GB           # ~25% of 64GB
effective_cache_size = 48GB     # ~75% of 64GB
work_mem = 32MB
maintenance_work_mem = 2GB
wal_level = replica
archive_mode = on
archive_command = '/usr/local/bin/walg-archive-wrapper %p'
archive_timeout = 60            # forces a WAL switch every 60s → caps RPO ~60s
max_wal_senders = 3
restore_command = 'wal-g wal-fetch %f %p'
log_min_duration_statement = 1000
```

### `walg-archive-wrapper`

```bash
#!/usr/bin/env bash
# WAL-G's wal-push has internal retries; we exit non-zero only on persistent failure
# so Postgres applies backpressure rather than silently losing WALs.
set -euo pipefail
exec wal-g wal-push "$1"
```

### Backup cadence (cron in `backup-cron` container)

| Schedule | Job | Destination |
|---|---|---|
| every minute (driven by `archive_timeout=60`) | `wal-g wal-push` via postgres `archive_command` | S3 (primary) |
| daily 02:00 UTC | `wal-g backup-push` (full base backup) | S3 |
| daily 03:00 UTC | `pg_dump --format=custom \| restic backup --stdin` | Storage Box (logical, encrypted) |
| hourly :15 | `rclone sync s3:inboxui-backups/walg storagebox:walg-mirror` | Storage Box (copy of S3 leg) |
| weekly Sunday 04:00 UTC | `wal-g delete retain FULL 30` + `restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune` | both |
| daily 05:00 UTC | "report status" — UPSERT row in `backup_status` table, ping Uptime Kuma push monitors | Postgres + Kuma |

### Three independent recovery paths

This is the load-bearing property of the design:

1. **WAL-G in S3** — full PITR to any second within the WAL retention window. The primary path.
2. **rclone mirror in Storage Box** — same physical files as (1), recovered by pointing WAL-G at the Storage Box prefix. Used when the S3 vendor is unreachable.
3. **restic pg_dump in Storage Box** — logically-formatted nightly dump. The "WAL-G itself has eaten the data silently" insurance. Restores via `pg_restore`. Loses up to 24h of writes.

If all three lines fail simultaneously you have a much bigger problem than this design can solve.

### Failure handling

- archive_command failure is loud: Postgres blocks writes once the WAL spool fills. This is intentional — silent backup loss is the worst failure mode.
- Each cron job logs to `/srv/inboxui/backup-logs/<job>.log` (rotated), exits non-zero on failure, and pings a unique Uptime Kuma push monitor on success. No heartbeat in N hours → page.
- The `backup_status` table is the source of truth for "when did each job last succeed":
  ```sql
  CREATE TABLE backup_status (
    job_name TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ NOT NULL,
    details JSONB
  );
  ```

## 4. Monitoring and CI/CD

### Uptime Kuma monitors

| Monitor | Type | Frequency | Alert if |
|---|---|---|---|
| `app-healthz` | HTTP GET `https://${DOMAIN}/api/healthz` | 60 s | non-200 for 2 consecutive checks |
| `walg-base-backup` | Push | daily expected | no heartbeat in 26 h |
| `walg-wal-archive` | Push | every 5 min expected | no heartbeat in 10 min |
| `restic-pgdump` | Push | daily expected | no heartbeat in 26 h |
| `rclone-mirror` | Push | hourly expected | no heartbeat in 75 min |

Alerts via Discord webhook (configurable to email/Slack in Kuma's UI).

### `/api/healthz` endpoint

`app/api/healthz/route.ts`. Returns JSON:

```json
{
  "status": "ok",
  "db": "ok",
  "backups": {
    "walg-base": "2026-05-13T02:00:14Z",
    "walg-wal": "2026-05-14T07:35:02Z",
    "restic-pgdump": "2026-05-13T03:00:08Z",
    "rclone-mirror": "2026-05-14T07:15:11Z"
  },
  "freshness_breach": false
}
```

`200` if db query succeeds and no backup is older than its tolerance; `503` otherwise. Tolerances live in code (e.g. `walg-wal` tolerates 10 min, others 26 h). Implementation reads from the `backup_status` table.

**Public exposure:** the endpoint reveals backup timestamps but no secrets. Acceptable for an internal app; if/when this becomes public-facing in a sensitive context, gate it behind a shared-secret header.

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml`:

- **Trigger**: push to `main`; manual `workflow_dispatch`.
- **Job `test`**: `npm ci` → `npm run lint` → `npm run test`.
- **Job `build`** (depends on `test`): builds two images, pushes both to GHCR with tags `:latest` and `:${{ github.sha }}`:
  - `ghcr.io/<owner>/inboxui` (the app)
  - `ghcr.io/<owner>/inboxui-postgres:17` and `ghcr.io/<owner>/inboxui-backup:latest` are built **only when their Dockerfile changes**, so day-to-day app deploys don't churn the database image.
- **Job `deploy`** (depends on `build`): `ssh deploy@${HOST}` running `~/deploy.sh ${{ github.sha }}`. The server-side `deploy.sh` is checked into the repo and synced via the SSH session.

`deploy.sh` (server-side) sequence:

```bash
set -euo pipefail
TAG=$1
cd /srv/inboxui
export IMAGE_TAG="$TAG"
docker compose pull
docker compose run --rm migrate
docker compose up -d --no-deps --remove-orphans app caddy
docker image prune -f
```

GH secrets needed: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` (deploy key, restricted to `deploy@` user with a forced command), `GHCR_TOKEN` (only if GHCR is private).

## 5. Disaster recovery

Three named scenarios with runbooks. Every runbook is in `deploy/runbooks/`, version-controlled, and links from the `deploy/README.md`.

### Scenario 1: App crash or bad deploy

**Detection**: Uptime Kuma alert on `app-healthz` failing OR app container restart-looping.

**Runbook (RTO < 5 min)**:
1. `ssh deploy@${HOST}` and `cd /srv/inboxui`.
2. `docker compose logs --tail=200 app caddy` to identify cause.
3. If recent deploy is the suspect: `IMAGE_TAG=<previous-sha> docker compose up -d app`.
4. Verify `curl https://${DOMAIN}/api/healthz` returns 200.
5. Open a ticket; do not redeploy `main` until the cause is identified.

### Scenario 2: DB corruption, accidental destructive query, or botched migration

**Detection**: app errors, data anomaly, user report.

**Runbook (RTO 30–60 min)**:
1. `docker compose stop app` — stop the bleeding. The DB stays up so we can read its current state.
2. Identify **target recovery time** (just before the destructive event). Sources: app logs, audit trails, user report.
3. Provision a recovery instance in a sibling compose project on the same host (a separate compose file, separate volume name) — this leaves the broken DB intact for forensics:
   ```bash
   cd /srv/inboxui/recovery
   docker compose up -d postgres-recovery   # empty volume
   docker compose exec postgres-recovery wal-g backup-fetch /var/lib/postgresql/data LATEST
   # write recovery.signal + recovery_target_time into the data dir
   docker compose restart postgres-recovery
   # WAL replay runs; postgres exits recovery and accepts connections
   ```
4. Verify the recovered DB on a non-public port; spot-check the data and the affected tables.
5. Promote: stop old postgres, `mv pgdata pgdata-corrupt-$(date +%s)`, `mv pgdata-recovery pgdata`, start postgres in the main compose project, run a fresh `migrate`, start app.
6. Take a fresh `wal-g backup-push` immediately.

### Scenario 3: Total host loss

**Detection**: host unreachable; Hetzner confirms hardware fault; or simply nothing for >15 min on uptime-kuma + ssh fails.

**Runbook (RTO 60–90 min)**:
1. Provision a replacement Hetzner box of the same class (or restore image to a hot spare if you keep one).
2. Run `deploy/scripts/bootstrap.sh` (creates `deploy` user, installs Docker, configures ufw/Tailscale, mounts `/srv/inboxui/`).
3. Restore secrets:
   - Pull `app.env` and `storagebox_id_ed25519` from password manager.
   - Write to `/srv/inboxui/secrets/` with mode 0600.
4. `docker compose up -d postgres` (the Postgres image will see an empty pgdata).
5. `docker compose exec postgres wal-g backup-fetch /var/lib/postgresql/data LATEST`
6. Write `recovery.signal` and `recovery_target_time = 'latest'` to pgdata; restart postgres; wait for WAL replay to complete.
7. `docker compose run --rm migrate` (no-op if up to date — guards against post-restore drift).
8. `docker compose up -d app caddy backup-cron uptime-kuma`.
9. Update DNS to point to the new IP (record TTL should already be ≤ 300 s).
10. Verify `https://${DOMAIN}/api/healthz`; verify Kuma sees green; take a fresh `wal-g backup-push`.

**Degraded paths if a destination is unavailable**:
- **S3 unreachable** (primary): switch `WALG_S3_PREFIX` to point at the Storage Box mirror via `s3://`-compatible config or temporarily configure WAL-G with `WALG_SSH_PREFIX` against the Storage Box. Documented in the runbook.
- **Both S3 and Storage Box unreachable**: fall back to the last nightly `pg_dump` via `restic restore`. Worst case = up to 24 h of writes lost — exactly the RPO budget allowed for this tier.

### DR drills (scheduled, not aspirational)

- **Monthly**: laptop drill. `wal-g backup-fetch` the latest base backup from S3 into a throwaway Docker volume; bring up Postgres; confirm row counts and recent timestamps are sane. 15-min job. Tracked as an Uptime Kuma "manual" push monitor — if no human checks in within 35 days, alert.
- **Quarterly**: full host-loss drill on a temporary Hetzner box. Run the Scenario 3 runbook end-to-end against a parallel domain. Tear down after verification. Time it; if it exceeds 90 min, treat the overrun as a P1 and address before the next drill.
- **Annually**: cross-destination drill — restore from Storage Box mirror with S3 access explicitly blocked. Confirms the secondary path actually works.

Drills produce a one-paragraph writeup committed to `deploy/runbooks/drill-log.md`. No writeup = the drill didn't happen.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| WAL-G silently archives garbage | Independent nightly `pg_dump` via restic — different tool, different format |
| Same-vendor backup correlation (Hetzner box + Storage Box both lost in one DC incident) | S3 leg uses a different vendor (B2 or R2) |
| Backup restoration is broken and nobody notices | Monthly + quarterly DR drills; alerts on missed drills |
| Secrets lost with host | Source of truth is password manager, not the host |
| Postgres image upgrade breaks pgdata | Postgres major-version upgrades require an explicit upgrade runbook; minor versions are safe |
| Hetzner pull bandwidth caps mid-restore | Pick a Storage Box in the same Hetzner location as the server so restic restores stay on internal network |
| GHCR outage blocks deploy | Already-running image keeps serving; deploys defer; not a data-loss risk |

## Repository layout (new files)

```
Dockerfile                          # app
.dockerignore
deploy/
  docker-compose.yml
  docker-compose.override.example.yml
  Caddyfile
  postgres/
    Dockerfile                      # postgres + wal-g
    postgresql.conf
    walg-archive-wrapper.sh
  backup/
    Dockerfile                      # alpine + wal-g + restic + rclone + cron
    crontab
    scripts/
      base-backup.sh
      pgdump.sh
      rclone-mirror.sh
      retention.sh
      report-status.sh              # writes to backup_status, pings kuma
  scripts/
    deploy.sh                       # server-side; runs migrate then up
    bootstrap.sh                    # one-time host setup
  runbooks/
    01-app-crash.md
    02-db-corruption.md
    03-total-host-loss.md
    drill-log.md
  README.md                         # operator-facing index + bootstrap order
.github/workflows/
  deploy.yml
app/api/healthz/route.ts
prisma/migrations/<timestamp>_backup_status/migration.sql
next.config.mjs                     # add output: 'standalone'
```

## Out of scope (for this iteration)

- Full metrics/log stack (Prometheus + Grafana + Loki) — can be layered on without changing this design.
- Read replicas, connection pooling (PgBouncer).
- Per-tenant DB isolation.
- Automated drill execution (drills stay human-driven for now).
- Cross-region replication of S3 backups (B2 / R2 already provide regional durability).
