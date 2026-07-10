# Runbook 03 — Total host loss

**Symptom**: host unreachable >15 min; Hetzner support confirms hardware fault; or `/api/healthz` down + SSH fails.

**RTO target**: 60–90 minutes.

## 1. Provision a replacement

- Order a Hetzner box of the same class (or restore an OS image to a hot spare if you keep one).
- Pick the same Hetzner location as the previous box so the Storage Box stays on the internal network.
- Note the new public IP.

## 2. Run the bootstrap

SSH in as root and:

```bash
git clone https://github.com/OWNER/inboxui /tmp/inboxui
sudo bash /tmp/inboxui/deploy/scripts/bootstrap.sh
```

This installs Docker, creates the `deploy` user, sets up `/srv/inboxui/`, and configures `ufw`.

## 3. Restore secrets

From your password manager (1Password / Bitwarden — source of truth, **not git**):

```bash
sudo -u deploy install -m 0600 /dev/stdin /srv/inboxui/secrets/app.env <<EOF
# paste contents from password manager
EOF
sudo -u deploy install -m 0600 /dev/stdin /srv/inboxui/secrets/storagebox_id_ed25519 <<EOF
# paste ssh private key from password manager
EOF
```

## 4. Restore the database

```bash
sudo cp /tmp/inboxui/deploy/docker-compose.yml /srv/inboxui/
sudo cp /tmp/inboxui/deploy/Caddyfile /srv/inboxui/
sudo cp /tmp/inboxui/deploy/scripts/deploy.sh /srv/inboxui/
sudo chmod +x /srv/inboxui/deploy.sh
sudo chown -R deploy:deploy /srv/inboxui/

sudo -u deploy bash <<'EOS'
cd /srv/inboxui
docker compose pull postgres
docker compose up -d postgres   # starts with empty pgdata
sleep 10
docker compose exec postgres wal-g backup-fetch /var/lib/postgresql/data LATEST

sudo tee /srv/inboxui/pgdata/postgresql.auto.conf >/dev/null <<'CFG'
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_action = 'promote'
CFG
sudo touch /srv/inboxui/pgdata/recovery.signal
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

### If S3 (primary) is unreachable
Switch the WAL-G config in `secrets/app.env` to read from the Storage Box mirror. Two options:
1. Point an S3-compatible client (rclone serve s3) at the Storage Box mirror, then leave WAL-G's S3 prefix unchanged but redirect via `AWS_ENDPOINT`.
2. Switch WAL-G to SSH mode by setting `WALG_SSH_PREFIX=ssh://...` against the Storage Box. WAL-G will fetch base backups from there.

### If both S3 AND Storage Box's mirror are unreachable
Fall back to the last restic `pg_dump`. This loses up to 24h of writes (the design's worst-case RPO for this tier).

```bash
# From the backup-cron container with restic env configured:
restic snapshots --tag pgdump
restic dump latest inboxui-<ts>.pgdump > /tmp/restore.pgdump
PGPASSWORD=$POSTGRES_PASSWORD pg_restore \
  --host=postgres --username=$POSTGRES_USER --dbname=$POSTGRES_DB \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/restore.pgdump
```
