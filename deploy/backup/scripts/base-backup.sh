#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

log "starting walg base backup"
PGHOST="${POSTGRES_HOST:-postgres}" PGPORT="${POSTGRES_PORT:-5432}" \
PGUSER="${POSTGRES_USER}" PGPASSWORD="${POSTGRES_PASSWORD}" \
  wal-g backup-push /var/lib/postgresql/data \
  >>"$LOG_DIR/base-backup.log" 2>&1
log "walg base backup complete"
record_success walg-base
