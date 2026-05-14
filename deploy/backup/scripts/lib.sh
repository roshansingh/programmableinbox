#!/usr/bin/env bash
# Shared helpers for backup cron scripts.
# - timestamped logging
# - heartbeat to Uptime Kuma push monitor on success
# - upserts a row in postgres `backup_status` on success
set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/log/backup}"
mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# Ping a Uptime Kuma push monitor.
#   KUMA_PUSH_BASE/push/<token>?status=up&msg=OK
kuma_ping() {
  local token="$1"
  local status="${2:-up}"
  if [[ -z "${KUMA_PUSH_BASE:-}" || -z "$token" || "$token" == "disabled" ]]; then
    return 0
  fi
  curl -fsSL --max-time 10 \
    "${KUMA_PUSH_BASE%/}/push/${token}?status=${status}&msg=OK" >/dev/null || true
}

# Record a successful run in the `backup_status` table.
record_success() {
  local job_name="$1"
  local details_json="${2:-null}"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    --host="${POSTGRES_HOST:-postgres}" \
    --port="${POSTGRES_PORT:-5432}" \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --no-password \
    --quiet \
    --command "INSERT INTO backup_status (job_name, last_success_at, details) \
               VALUES ('$job_name', now(), '$details_json'::jsonb) \
               ON CONFLICT (job_name) DO UPDATE SET \
                 last_success_at = EXCLUDED.last_success_at, \
                 details = EXCLUDED.details;"
}
