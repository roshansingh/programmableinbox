#!/usr/bin/env bash
# Shared helpers for backup cron scripts.
# - timestamped logging
# - upserts a row in postgres `backup_status` on success
set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/log/backup}"
mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# ---------------------------------------------------------------------------
# Database credentials (issue #41).
#
# Backups connect as the dedicated read-scoped role (pg_read_all_data + the
# backup-control functions + write on `backup_status`), NOT as the cluster
# superuser. If the deployment has not been converted yet we still work, but we
# say so loudly on every run rather than failing backups silently.
# ---------------------------------------------------------------------------
BACKUP_DB_USER="${POSTGRES_BACKUP_USER:-}"
BACKUP_DB_PASSWORD="${POSTGRES_BACKUP_PASSWORD:-}"

if [ -z "$BACKUP_DB_USER" ] || [ -z "$BACKUP_DB_PASSWORD" ]; then
  BACKUP_DB_USER="${POSTGRES_USER}"
  BACKUP_DB_PASSWORD="${POSTGRES_PASSWORD}"
  log "WARNING: POSTGRES_BACKUP_USER/POSTGRES_BACKUP_PASSWORD unset — falling back to '${POSTGRES_USER}', which is the cluster superuser. Convert this deployment: deploy/runbooks/04-postgres-role-rotation.md"
fi
export BACKUP_DB_USER BACKUP_DB_PASSWORD

# Record a successful run in the `backup_status` table.
record_success() {
  local job_name="$1"
  local details_json="${2:-null}"
  PGPASSWORD="${BACKUP_DB_PASSWORD}" psql \
    --host="${POSTGRES_HOST:-postgres}" \
    --port="${POSTGRES_PORT:-5432}" \
    --username="${BACKUP_DB_USER}" \
    --dbname="${POSTGRES_DB}" \
    --no-password \
    --quiet \
    --command "INSERT INTO backup_status (job_name, last_success_at, details) \
               VALUES ('$job_name', now(), '$details_json'::jsonb) \
               ON CONFLICT (job_name) DO UPDATE SET \
                 last_success_at = EXCLUDED.last_success_at, \
                 details = EXCLUDED.details;"
}
