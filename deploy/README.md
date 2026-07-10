# Deployment — operator's guide

This directory is the source of truth for deploying inboxui to a Hetzner bare-metal box. See [`docs/superpowers/specs/2026-05-14-deployment-bare-metal-design.md`](../docs/superpowers/specs/2026-05-14-deployment-bare-metal-design.md) for the design rationale.

## Bootstrap (one time)

1. Provision a Hetzner AX-line box with Ubuntu LTS. Note its IP.
2. Pick a Hetzner Storage Box in the same Hetzner location.
3. Create an S3-compatible bucket (Backblaze B2 or Cloudflare R2 recommended).
4. SSH in as root and:
   ```bash
   git clone https://github.com/OWNER/inboxui /tmp/inboxui
   sudo bash /tmp/inboxui/deploy/scripts/bootstrap.sh
   ```
5. As the `deploy` user, populate `/srv/inboxui/secrets/`:
   - `app.env` (mode 0600) — see the secrets section of the design doc for keys (app, Postgres init, WAL-G/S3, restic, rclone — all in one file).
   - `storagebox_id_ed25519` (mode 0600) — SSH private key for the Storage Box.
6. Copy compose + Caddyfile + deploy.sh into `/srv/inboxui/`:
   ```bash
   sudo cp /tmp/inboxui/deploy/docker-compose.yml /srv/inboxui/
   sudo cp /tmp/inboxui/deploy/Caddyfile /srv/inboxui/
   sudo cp /tmp/inboxui/deploy/scripts/deploy.sh /srv/inboxui/
   sudo chown -R deploy:deploy /srv/inboxui/
   sudo chmod +x /srv/inboxui/deploy.sh
   ```
7. Initial deploy from CI: push to `main`, watch the GH Actions run, wait for green.
8. Inside the Postgres container, confirm WAL archiving works:
   ```bash
   docker compose exec postgres wal-g wal-show
   ```
9. Force a first base backup:
   ```bash
   docker compose exec backup-cron /scripts/base-backup.sh
   ```

## Day-to-day

Pushing to `main` runs CI; tests + build + SSH deploy + migration are automatic.

## DR drills

- **Monthly**: laptop drill — restore latest base + a few hours of WAL into a throwaway docker volume. Verify row counts. Write to `runbooks/drill-log.md`.
- **Quarterly**: full host-loss drill on a temporary Hetzner box. Run runbook 03 end-to-end against a parallel domain.
- **Annually**: cross-destination drill — restore from the Storage Box mirror with S3 access explicitly blocked.

## When things go wrong

- `runbooks/01-app-crash.md` — app down, deploy regression
- `runbooks/02-db-corruption.md` — point-in-time recovery
- `runbooks/03-total-host-loss.md` — rebuild on a new box
