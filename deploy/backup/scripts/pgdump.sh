#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

log "starting pg_dump + restic"
TS="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"

# Stream pg_dump directly into restic; no intermediate file on disk.
PGPASSWORD="${BACKUP_DB_PASSWORD}" pg_dump \
  --host="${POSTGRES_HOST:-postgres}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${BACKUP_DB_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=0 \
  2>>"$LOG_DIR/pgdump.log" \
  | restic backup \
      --stdin \
      --stdin-filename "inboxui-${TS}.pgdump" \
      --tag pgdump \
      --tag "ts=${TS}" \
      >>"$LOG_DIR/pgdump.log" 2>&1

log "pg_dump + restic complete"
record_success restic-pgdump "{\"snapshot_ts\":\"$TS\"}"
