#!/usr/bin/env bash
# Cron strips most env from child processes. We export the variables we care
# about into /etc/environment so cron's children inherit them, then generate
# rclone's config from env and fix permissions on the Storage Box SSH key.
set -euo pipefail

mkdir -p /var/log/backup

{
  echo "# auto-written by entrypoint at $(date -u)"
  env | grep -E '^(POSTGRES_|WALG_|AWS_|RCLONE_|RESTIC_|KUMA_|STORAGEBOX_)' \
     | sed -E 's/^([^=]+)=(.*)$/\1="\2"/'
} > /etc/environment

mkdir -p /root/.config/rclone
cat > /root/.config/rclone/rclone.conf <<RCLONE
[s3-walg]
type = s3
provider = ${WALG_S3_PROVIDER:-Other}
env_auth = true
endpoint = ${AWS_ENDPOINT:-}
region = ${AWS_REGION:-auto}

[storagebox]
type = sftp
host = ${RCLONE_STORAGEBOX_HOST:-}
user = ${RCLONE_STORAGEBOX_USER:-}
key_file = /secrets/storagebox_id_ed25519
RCLONE

if [[ -f /secrets/storagebox_id_ed25519 ]]; then
  chmod 0600 /secrets/storagebox_id_ed25519
fi

exec cron -f
