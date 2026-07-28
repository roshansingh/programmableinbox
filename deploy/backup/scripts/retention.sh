#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

log "starting retention sweeps"

# Keep 30 full backups + their WALs. WAL-G auto-prunes WAL beyond the
# oldest retained base backup.
PGHOST="${POSTGRES_HOST:-postgres}" PGPORT="${POSTGRES_PORT:-5432}" \
PGUSER="${BACKUP_DB_USER}" PGPASSWORD="${BACKUP_DB_PASSWORD}" \
  wal-g delete retain FULL 30 --confirm \
  >>"$LOG_DIR/retention.log" 2>&1

restic forget \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 6 \
  --tag pgdump \
  --prune \
  >>"$LOG_DIR/retention.log" 2>&1

log "retention sweeps complete"
record_success retention
