# OVH + Backblaze B2 deployment revision — design

Status: approved 2026-07-10. Revision of the [2026-05-14 bare-metal deployment design](./2026-05-14-deployment-bare-metal-design.md). Moves the host from Hetzner to **OVH**, collapses backups from a two-vendor (S3 + Hetzner Storage Box) layout onto a **single Backblaze B2 destination** hardened with Object Lock, closes the **Redis** code/deploy gap, and moves monitoring to **Uptime Kuma hosted on PikaPods** (external to the box).

Everything in the 2026-05-14 design that is not called out below is unchanged (app Dockerfile, Caddy reverse proxy, migration container, CI/CD via GitHub Actions → GHCR → SSH `deploy.sh`, `/api/healthz`, the `backup_status` table, DR drill cadence).

## Why this revision

- The deployment target is now **OVH**, so the **Hetzner Storage Box is gone**. Both backup legs that landed on the Storage Box (rclone mirror + restic pg_dump) need a new home.
- The original design's load-bearing property was "three recovery paths across two independent vendors." Consolidating onto one vendor is a deliberate trade for simplicity and cost, accepted for this tier — with Object Lock added to recover the main resilience we'd otherwise lose.
- Backblaze B2 was chosen over OVH Object Storage after a pricing/independence comparison (below): it is cheaper per-TB **and** independent of the OVH host, so it survives an OVH-level failure. Putting the only backup on the host's own provider would defeat "survive total host loss."
- The app depends on Redis (BullMQ webhook queue) but neither the old design nor the compose file provisioned it. This revision closes that gap.

### Destination pricing comparison (July 2026)

| | Storage | Egress | Notes |
|---|---|---|---|
| **Backblaze B2** (chosen) | ~$6.95/TB/mo | Free to 3× stored/mo, then $0.01/GB; free via Cloudflare CDN | First 10 GB free. Independent of OVH host. |
| OVH Standard 1-AZ | ~$9/TB/mo (£7 / ~€8) | Free (removed 2026-01-01) | Same vendor as host — co-locates the only backup with the box. |
| OVH Standard 3-AZ | ~$15–18/TB/mo (€0.014/GB) | Free | 3-zone durability, but 2× B2 cost and still same-vendor. |

At this app's scale (~hundreds of GB of retained backups) the absolute monthly difference is a dollar or two, so cost is not the driver — **independence from the host provider is**, and B2 wins on both.

## 1. Host and network (OVH)

- **Box**: OVH bare-metal dedicated server (Advance/Scale range — ~64 GB RAM, 2×NVMe in software RAID1), Ubuntu LTS. Single box, all services in one `docker-compose.yml`, unchanged topology.
- **Firewall**: host `ufw` allows only 22 (key-only SSH), 80, 443. **OVH Network Firewall** is the second layer with the same rules (replaces the Hetzner Cloud Firewall). Tailscale on the host for SSH; drop public SSH after bootstrap.
- **Region pairing**: place the B2 bucket in the region nearest the OVH datacenter (e.g., OVH Gravelines/Roubaix → B2 **EU-Central**) to minimise restore latency. B2 egress is free to 3× stored/mo, which comfortably covers a full DR restore (~1× the dataset).
- **Bind mounts** under `/srv/inboxui/`: `pgdata`, `pgwal-archive-staging`, `caddy-data`, `caddy-config`, `secrets` (0700), `backup-logs`, plus a new `redis` dir (§5). The `kuma` volume is removed.
- Host baseline (non-root `deploy` user, `unattended-upgrades`, swap=0, secrets in `app.env` mode 0600) is unchanged from the 2026-05-14 design.

## 2. Backup pipeline — single destination (Backblaze B2)

Two legs, both to B2. The old **rclone-mirror leg is deleted entirely** (it existed only to copy the S3 leg onto the Storage Box).

| Schedule | Job | Backend |
|---|---|---|
| continuous (`archive_timeout=60`) | `wal-g wal-push` via Postgres `archive_command` | B2 (S3 API) |
| daily 02:00 UTC | `wal-g backup-push` (full base backup) | B2 (S3 API) |
| daily 03:00 UTC | `pg_dump --format=custom \| restic backup --stdin` | B2 (restic native b2 backend) |
| weekly Sun 04:00 UTC | `wal-g delete retain FULL 30` + `restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 6` | B2 |
| daily 05:00 UTC | "report status" — UPSERT `backup_status` + Kuma heartbeat | Postgres + Kuma |

- **WAL-G → B2** (S3-compatible API): `WALG_S3_PREFIX=s3://<bucket>/walg`, `AWS_ENDPOINT=https://s3.<region>.backblazeb2.com`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` = a B2 application key, `WALG_COMPRESSION_METHOD=zstd`.
- **restic → B2** (native backend): `RESTIC_REPOSITORY=b2:<bucket>:pgdump`, `B2_ACCOUNT_ID`/`B2_ACCOUNT_KEY`, `RESTIC_PASSWORD` for client-side encryption.
- Postgres config (`archive_mode=on`, `archive_timeout=60`, loud archive backpressure on failure) and the `backup_status` table are unchanged.

### `app.env` changes

Remove the Storage Box / rclone blocks (`RESTIC_REPOSITORY=sftp:...`, `RCLONE_CONFIG_STORAGEBOX_*`) and the `storagebox_id_ed25519` key file. Add:

```
# WAL-G → Backblaze B2 (S3 API)
WALG_S3_PREFIX=s3://<walg-bucket>/walg
AWS_ENDPOINT=https://s3.<region>.backblazeb2.com
AWS_ACCESS_KEY_ID=<b2-keyID>
AWS_SECRET_ACCESS_KEY=<b2-appKey>
WALG_COMPRESSION_METHOD=zstd

# restic pg_dump → Backblaze B2 (native b2 backend)
RESTIC_REPOSITORY=b2:<pgdump-bucket>:pgdump
B2_ACCOUNT_ID=<b2-keyID>
B2_ACCOUNT_KEY=<b2-appKey>
RESTIC_PASSWORD=<restic-encryption-password>

# Redis
REDIS_URL=redis://redis:6379

# Uptime Kuma push (PikaPods-hosted) — see §6
KUMA_PUSH_BASE=https://<your-kuma>.pikapod.net
KUMA_TOKEN_WALG_BASE=<token>
KUMA_TOKEN_RESTIC_PGDUMP=<token>
KUMA_TOKEN_WALG_WAL=<token>
```

The `entrypoint.sh` env passthrough and `bootstrap.sh` directory list are updated to match (drop `STORAGEBOX_`, drop the `kuma` dir, add `redis` dir; re-add `KUMA_` for the push tokens).

## 3. Object Lock (single-destination hardening)

With no second vendor, the main residual risk is destruction of the one copy — accidental deletion, a stolen host key, or ransomware. B2 Object Lock mitigates this:

- **WAL-G bucket**: Object Lock in **Governance** mode, default retention set **shorter than the base-backup retention** (e.g., lock 14 days while keeping 30 days of fulls). `wal-g delete retain FULL 30` only ever deletes objects older than the retention window, so pruning never collides with an active lock. The host's B2 application key is scoped **without** the bypass-governance capability, so a compromised host cannot delete recent backups.
- **restic bucket**: Object Lock is incompatible with `restic prune` (prune must delete/rewrite locked pack files). Instead, protect this leg with an **append-only B2 application key** (no `deleteFiles`) for the host plus a B2 **lifecycle rule** to expire old file versions; a true `restic prune` runs from a maintenance context with a separate privileged key. **The exact key scoping + lifecycle window is deferred to the implementation plan.**
- A **separate B2 application key with full privileges is held offline** (password manager only), for retention maintenance and as the break-glass path if the host key is compromised.

## 4. Recovery paths and disaster recovery

Down to **two independent-by-tool paths, both in B2**:

1. **WAL-G physical PITR** — restore to any second within the WAL retention window. Primary path.
2. **restic pg_dump logical** — a different tool and format; insurance against WAL-G silently archiving corrupt data. Restores via `pg_restore`; loses up to 24h of writes.

Runbook changes (`deploy/runbooks/`):

- **02-db-corruption**: recovery-instance flow unchanged; `backup-fetch` now targets the B2 prefix.
- **03-total-host-loss**: provision a replacement **OVH** box, run `bootstrap.sh`, restore secrets from the password manager, `wal-g backup-fetch LATEST` from B2 + WAL replay, migrate, bring the stack up, repoint DNS (TTL ≤300s). All **Storage Box degraded-path steps are removed**. The remaining degraded path: **B2 region/account unreachable → fall back to the last restic pg_dump** (worst case ≤24h of writes lost — the RPO budget for this tier). If the host's B2 key is compromised, recover using the offline privileged key against the Object-Locked WAL-G bucket.
- **Risk table**: the "same-vendor backup correlation" row now reads — *host on OVH, backups on B2: genuinely independent vendors. Residual risk is full B2 account loss, mitigated by Object Lock (Governance) + an offline-held privileged B2 key.*

DR drill cadence (monthly restore-to-throwaway, quarterly full host-loss on a temp OVH box, annual — now a **restic-only** restore with the WAL-G bucket access explicitly blocked, to prove the logical leg) is otherwise unchanged. Drills are logged in `deploy/runbooks/drill-log.md`.

## 5. Redis (closing the code/deploy gap)

The app's `lib/webhooks/queue.ts` + `worker.ts` use BullMQ + ioredis against `REDIS_URL`, but nothing provisioned Redis or ran the worker.

- **`redis` container**: `redis:7-alpine`, started with `--appendonly yes --appendfsync everysec`, bind-mounted at `/srv/inboxui/redis`, on `inboxui-internal`, **no published port**. `restart: unless-stopped`.
- **`worker` container**: reuses the app image with a new worker entrypoint that starts the BullMQ `Worker` from `lib/webhooks/worker.ts`. The web `app` container continues to run only `node server.js`; the worker is a separate process/container. `restart: unless-stopped`, `depends_on` postgres (healthy) + redis. `REDIS_URL=redis://redis:6379`.
- **App config**: `REDIS_URL` added to `app.env`; the `app` container also gets it so route handlers can enqueue.

### Redis DR posture — ephemeral, not backed up

Redis is **excluded from all backups and PITR**. Jobs are idempotent via the `(externalId, inboxEmailAddressId)` unique constraint, so redelivery/replay is safe, and AOF (`everysec`) provides restart durability. On Redis data loss, at most a small amount of in-flight webhook processing is lost.

**Documented risk (follow-up, not part of this revision):** the webhook route acks Resend with 200 on enqueue, so if Redis is lost *after* the ack but *before* the worker processes a job, Resend will not redeliver and that email is dropped. AOF `everysec` bounds the window to ~1s. Fully closing it would require persisting a durable row before enqueue; that is noted as a future improvement, out of scope here.

## 6. Monitoring — Uptime Kuma on PikaPods (external)

Uptime Kuma is **not** run on the OVH box (no `uptime-kuma` service, no `kuma` volume — both stay removed from the 2026-05-14 layout). It runs on **[PikaPods](https://www.pikapods.com)**, external to the deployment, so a `/api/healthz` failure *or* total host loss both trip it.

- **HTTP monitor**: Kuma polls `https://${DOMAIN}/api/healthz` every 60s; alerts on non-200 for 2 consecutive checks.
- **Push monitors (dead-man's-switch)**: each backup job curls its Kuma push URL on success. Monitors and tolerances: `walg-base` (26h), `walg-wal` (10min), `restic-pgdump` (26h). The `rclone-mirror` monitor is dropped with that leg.
- **Scripts**: re-introduces a small heartbeat helper in the backup scripts (the previously-removed `kuma_ping`), but `KUMA_PUSH_BASE` now points at the **PikaPods Kuma URL over HTTPS**, not a local container. `backup-cron` already makes outbound HTTPS calls (to B2), so this adds no new inbound exposure. Push tokens live in `app.env`.
- **Alerts**: Discord/email/Slack, configured in Kuma's UI.

## Files touched

- `deploy/docker-compose.yml` — add `redis` + `worker` services; already has no `uptime-kuma`.
- `deploy/backup/scripts/*.sh` — re-add heartbeat helper (pointing at PikaPods Kuma); switch restic to the B2 backend; drop rclone-mirror.
- `deploy/backup/scripts/rclone-mirror.sh` — **removed** (leg deleted).
- `deploy/backup/entrypoint.sh` — env passthrough: drop `STORAGEBOX_`/`RCLONE_`, keep/readd `KUMA_`, add `B2_`.
- `deploy/scripts/bootstrap.sh` — drop `kuma` dir, add `redis` dir; OVH firewall note.
- `deploy/README.md` — OVH bootstrap, B2 bucket + Object Lock setup, PikaPods Kuma setup, updated `app.env` keys.
- `deploy/runbooks/02-*.md`, `03-*.md` — B2 restore, remove Storage Box steps, add compromised-key path.
- New worker entrypoint referenced by the `worker` container.

## Out of scope (unchanged from 2026-05-14, plus)

- Full metrics/log stack (Prometheus/Grafana/Loki).
- Read replicas, PgBouncer.
- Closing the Redis ack-before-process window (durable pre-enqueue write) — noted as a follow-up.
- A second backup vendor — deliberately single-destination for now; Object Lock covers the primary residual risk.
