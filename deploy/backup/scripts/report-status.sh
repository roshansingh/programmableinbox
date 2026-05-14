#!/usr/bin/env bash
# Heartbeat job — runs frequently to confirm the cron container itself is
# alive, independent of whether the long-running jobs are due.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

log "cron heartbeat"
record_success cron-heartbeat
