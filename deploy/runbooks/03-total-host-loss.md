# Runbook 03 — Total host loss

**Symptom**: host unreachable >15 min; Hetzner support confirms hardware fault; or `/api/healthz` down + SSH fails.

**RTO target**: 60–90 minutes.

## 1. Provision a replacement

- Order a Hetzner box of the same class (or restore an OS image to a hot spare if you keep one).
- Pick a region near your Backblaze B2 bucket to keep restore latency low.
- Note the new public IP.

## 2. Run the bootstrap

SSH in as root and:

```bash
git clone https://github.com/OWNER/programmableinbox /tmp/programmableinbox
sudo bash /tmp/programmableinbox/deploy/scripts/bootstrap.sh
```

This installs Docker, creates the `deploy` user, sets up `/srv/programmableinbox/`, and configures `ufw`.

## 3. Restore secrets

From your password manager (1Password / Bitwarden — source of truth, **not git**):

```bash
sudo -u deploy install -m 0600 /dev/stdin /srv/programmableinbox/secrets/app.env <<EOF
# paste contents from password manager
EOF
```

## 4. Restore the database

```bash
sudo cp /tmp/programmableinbox/deploy/docker-compose.yml /srv/programmableinbox/
sudo cp /tmp/programmableinbox/deploy/Caddyfile /srv/programmableinbox/
sudo cp /tmp/programmableinbox/deploy/scripts/initial_deploy.sh /srv/programmableinbox/
sudo chmod +x /srv/programmableinbox/initial_deploy.sh
sudo chown -R deploy:deploy /srv/programmableinbox/

sudo -u deploy bash <<'EOS'
cd /srv/programmableinbox
docker compose pull postgres
docker compose up -d postgres   # starts with empty pgdata
sleep 10
docker compose exec postgres wal-g backup-fetch /var/lib/postgresql/data LATEST

sudo tee /srv/programmableinbox/pgdata/postgresql.auto.conf >/dev/null <<'CFG'
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_action = 'promote'
CFG
sudo touch /srv/programmableinbox/pgdata/recovery.signal
docker compose restart postgres
EOS
```

Watch logs until WAL replay completes:

```bash
docker compose logs -f postgres
# Look for: "archive recovery complete" then "database system is ready"
```

## 5. Bring up the rest of the stack

```bash
sudo -u deploy docker compose pull
sudo -u deploy docker compose run --rm migrate   # no-op if up to date
sudo -u deploy docker compose up -d
```

## 6. Update DNS

Point the `${DOMAIN}` A record at the new IP. Record TTL should already be ≤ 300s. Wait for propagation.

## 7. Verify

```bash
curl -fsS https://$DOMAIN/api/healthz | jq
```

Expect 200, `db: ok`, `freshness_breach: false`. The `walg-wal` timestamp will catch up within a minute of the first `archive_command` push.

## 8. Take an immediate fresh base backup

```bash
docker compose exec backup-cron /scripts/base-backup.sh
```

## 9. Decommission the old box

Only after step 8 succeeds and `/api/healthz` reports green. Take screenshots of the dashboards first.

## Degraded paths

### If Backblaze B2 is unreachable
B2 is the only backup destination, so while it is unreachable there is no alternate source for WAL-G physical recovery. Options:
1. Wait out a transient B2 regional outage; recovery resumes once B2 returns.
2. If B2 is reachable but the host's application key was compromised or revoked, re-run the restore with the offline privileged B2 key (from the password manager) against the Object-Locked WAL-G bucket.

### If the WAL-G bucket is unusable but the restic bucket is intact
Fall back to the last restic `pg_dump`. This loses up to 24h of writes (the worst-case RPO for this tier).

```bash
# From the backup-cron container with restic env configured (B2 backend):
restic snapshots --tag pgdump
restic dump latest programmableinbox-<ts>.pgdump > /tmp/restore.pgdump
PGPASSWORD=$POSTGRES_PASSWORD pg_restore \
  --host=postgres --username=$POSTGRES_USER --dbname=$POSTGRES_DB \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/restore.pgdump
```
