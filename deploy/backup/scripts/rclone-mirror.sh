#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

log "starting rclone mirror s3 -> storagebox"
SRC="s3-walg:${WALG_S3_BUCKET}/${WALG_S3_PATH}"
DST="storagebox:${STORAGEBOX_MIRROR_PATH}"

rclone sync "$SRC" "$DST" \
  --transfers=8 --checkers=16 \
  --log-file="$LOG_DIR/rclone-mirror.log" --log-level INFO

log "rclone mirror complete"
record_success rclone-mirror
kuma_ping "${KUMA_TOKEN_RCLONE_MIRROR:-disabled}"
