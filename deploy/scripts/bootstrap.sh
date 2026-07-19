#!/usr/bin/env bash
# One-time host bootstrap. Run as root on a freshly-provisioned Ubuntu LTS box.
# IDEMPOTENT: safe to re-run; only applies missing pieces.
set -euo pipefail

DEPLOY_USER=deploy
SRV_DIR=/srv/inboxui

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root"; exit 1
fi

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg ufw unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups docker "$DEPLOY_USER"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 "$SRV_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 \
  "$SRV_DIR/pgdata" \
  "$SRV_DIR/redis" \
  "$SRV_DIR/backup-logs"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SRV_DIR/secrets"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

dpkg-reconfigure -plow unattended-upgrades || true

echo
echo "Bootstrap done. Next steps:"
echo "  1. As $DEPLOY_USER: place secrets/app.env under $SRV_DIR/secrets/ (mode 0600)."
echo "  2. Copy deploy/docker-compose.yml, deploy/Caddyfile, and deploy/scripts/initial_deploy.sh into $SRV_DIR/ (chmod +x initial_deploy.sh)."
echo "  3. wal-g backup-fetch (if restoring) OR docker compose up -d postgres + docker compose run --rm migrate for fresh install."
echo "  4. Initialise WAL-G storage:  docker compose exec postgres wal-g backup-list  (should succeed with empty list)."
echo "  5. Add deploy@host SSH key to GH Actions secrets; trigger a deploy."
