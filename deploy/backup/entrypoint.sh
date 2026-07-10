#!/usr/bin/env bash
# Cron strips most env from child processes. We export the variables we care
# about into /etc/environment so cron's children inherit them.
set -euo pipefail

mkdir -p /var/log/backup

{
  echo "# auto-written by entrypoint at $(date -u)"
  env | grep -E '^(POSTGRES_|WALG_|AWS_|RESTIC_|B2_|KUMA_)' \
     | sed -E 's/^([^=]+)=(.*)$/\1="\2"/'
} > /etc/environment

exec cron -f
