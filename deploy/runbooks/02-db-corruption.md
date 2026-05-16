# Runbook 02 — Database corruption / accidental destructive operation

**Symptom**: data anomaly, app errors with database constraint violations, user report of missing/wrong data, botched migration.

**RTO target**: 30–60 minutes.

## 1. Stop the bleeding

```bash
ssh deploy@$HOST
cd /srv/inboxui
docker compose stop app
```

Postgres stays up so you can read its current state during triage. The web app no longer writes new data.

## 2. Identify the recovery target time

Sources: app logs, audit records, user report. Pick a timestamp **just before** the destructive event in UTC, e.g. `2026-05-14 13:42:30 UTC`.

## 3. Prepare a recovery instance (sibling data directory)

This restores into a fresh data dir **next to** the broken one. The broken DB stays intact for forensics.

```bash
sudo install -d -o 70 -g 70 -m 0700 /srv/inboxui/pgdata-recovery
docker run --rm \
  --network inboxui_inboxui-internal \
  --env-file /srv/inboxui/secrets/app.env \
  -v /srv/inboxui/pgdata-recovery:/var/lib/postgresql/data \
  ghcr.io/OWNER/inboxui-postgres:17 \
  bash -c "wal-g backup-fetch /var/lib/postgresql/data LATEST"
```

## 4. Configure recovery target and start

```bash
cat <<EOF | sudo tee /srv/inboxui/pgdata-recovery/postgresql.auto.conf
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '2026-05-14 13:42:30 UTC'
recovery_target_action = 'promote'
EOF
sudo touch /srv/inboxui/pgdata-recovery/recovery.signal
```

Spin up the recovery instance on an alternate port (no compose; one-off container):

```bash
docker run --rm -d --name pg-recovery \
  --network inboxui_inboxui-internal \
  -p 127.0.0.1:5433:5432 \
  --env-file /srv/inboxui/secrets/app.env \
  -v /srv/inboxui/pgdata-recovery:/var/lib/postgresql/data \
  ghcr.io/OWNER/inboxui-postgres:17 \
  postgres -c config_file=/etc/postgresql/postgresql.conf
```

Wait for WAL replay (watch the logs):

```bash
docker logs -f pg-recovery
# Look for: "archive recovery complete" then "database system is ready to accept connections"
```

## 5. Verify the recovery

Connect on the alternate port and spot-check:

```bash
PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -p 5433 -U $POSTGRES_USER -d $POSTGRES_DB <<SQL
SELECT count(*) FROM "EmailMessage";
SELECT max("createdAt") FROM "EmailMessage";
-- inspect the table that was corrupted
SQL
```

## 6. Promote the recovery as primary

```bash
docker compose stop postgres
sudo mv /srv/inboxui/pgdata /srv/inboxui/pgdata-corrupt-$(date +%s)
sudo mv /srv/inboxui/pgdata-recovery /srv/inboxui/pgdata
docker rm -f pg-recovery
docker compose up -d postgres
docker compose run --rm migrate    # no-op if schema unchanged
docker compose up -d app
```

## 7. Take a fresh base backup immediately

```bash
docker compose exec backup-cron /scripts/base-backup.sh
```

## 8. Postmortem

Write up: cause, scope, what worked, what was slow. Commit to `deploy/runbooks/drill-log.md`.
