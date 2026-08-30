#!/usr/bin/env bash
# ===========================================================================
# Apply (or re-apply) the least-privileged Postgres role model to a RUNNING
# cluster. Run this on the deployment host, as the `deploy` user:
#
#     /srv/programmableinbox/pg-apply-least-privilege.sh
#
# HOST-SIDE WRAPPER ONLY. All it does is preflight the compose service and then
# `docker compose exec` the real script, which is baked into the postgres image
# from deploy/postgres/apply-least-privilege.sh and cannot run outside the
# container. The privilege logic itself lives in one place:
# deploy/postgres/least-privilege-roles.sql.
#
# Why this exists: the role model is normally installed by the postgres image's
# /docker-entrypoint-initdb.d hook, and that hook runs ONLY on a first-time
# init with an empty PGDATA. Every already-deployed cluster therefore needs
# this one-shot (but idempotent) conversion. Full procedure — including how to
# repoint the app and roll back — is in
# deploy/runbooks/04-postgres-role-rotation.md.
#
# Safe to run repeatedly. Run it:
#   * once, when converting an existing deployment;
#   * after restoring a cluster from a logical (pg_dump) backup;
#   * whenever you rotate POSTGRES_{APP,MIGRATOR,BACKUP}_PASSWORD;
#   * after the first `docker compose run --rm migrate` on a brand-new cluster,
#     so the backup role picks up its grant on `backup_status`.
#
# It reads nothing itself — every value comes from the postgres container's own
# environment, which compose populates from /srv/programmableinbox/secrets/app.env.
# ===========================================================================
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/srv/programmableinbox}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

cd "$COMPOSE_DIR"

if ! docker compose ps --status running --services | grep -qx "$SERVICE"; then
  echo "ERROR: compose service '$SERVICE' is not running in $COMPOSE_DIR." >&2
  echo "       Start it first: docker compose up -d $SERVICE" >&2
  exit 1
fi

if ! docker compose exec -T "$SERVICE" test -x /usr/local/bin/programmableinbox-apply-least-privilege; then
  echo "ERROR: the running postgres image predates the least-privilege role model." >&2
  echo "       Pull a newer image and recreate the container first:" >&2
  echo "         docker compose pull $SERVICE && docker compose up -d $SERVICE" >&2
  echo "       (recreating the container does NOT touch /srv/programmableinbox/pgdata)" >&2
  exit 1
fi

echo "Applying least-privileged role model to service '$SERVICE'..."

# PGHOST is forced to TCP: the container is already up, so listen_addresses is
# in effect and this authenticates through pg_hba's scram rule exactly like the
# application does.
docker compose exec -T -e PGHOST=127.0.0.1 "$SERVICE" \
  /usr/local/bin/programmableinbox-apply-least-privilege

# Unquoted heredoc so $SERVICE resolves to the service this run actually used.
# $POSTGRES_USER / $POSTGRES_DB are escaped so they stay literal — the operator
# substitutes their own values when running the command.
cat <<EOF

Done. Verify before repointing anything:

  docker compose exec -T $SERVICE psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -c '\du'

Then follow deploy/runbooks/04-postgres-role-rotation.md from step 4 to move
DATABASE_URL / MIGRATE_DATABASE_URL onto the new roles.
EOF
