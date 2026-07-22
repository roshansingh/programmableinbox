#!/usr/bin/env bash
# ===========================================================================
# Applies deploy/postgres/least-privilege-roles.sql to the local cluster.
#
# RUNS INSIDE THE POSTGRES CONTAINER. It needs psql, the SQL file and the
# container's own environment, so it cannot be run from the host. The host-side
# entry point is deploy/scripts/pg-apply-least-privilege.sh, which is a thin
# `docker compose exec` wrapper around this file plus some preflight checks —
# the two are not duplicates of each other.
#
# Installed into the postgres image as /usr/local/bin/inboxui-apply-least-privilege
# and run from two places:
#
#   * /docker-entrypoint-initdb.d/10-least-privilege-roles.sh, i.e. once, on a
#     FIRST-TIME cluster init only (empty PGDATA).
#   * deploy/scripts/pg-apply-least-privilege.sh, i.e. by an operator, against
#     an already-initialised cluster (`docker compose exec postgres ...`).
#
# It is idempotent — running it repeatedly is expected and supported. It is
# also how the three role passwords are rotated.
#
# Required env (all normally live in /srv/inboxui/secrets/app.env):
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD   bootstrap superuser
#   POSTGRES_APP_PASSWORD                           runtime role
#   POSTGRES_MIGRATOR_PASSWORD                      DDL/owner role
#   POSTGRES_BACKUP_PASSWORD                        backup role
#
# Optional env (defaults shown):
#   POSTGRES_APP_USER=inboxui_app
#   POSTGRES_MIGRATOR_USER=inboxui_migrator
#   POSTGRES_BACKUP_USER=inboxui_backup
#   PGHOST=/var/run/postgresql
# ===========================================================================
set -euo pipefail

SQL_FILE="${INBOXUI_ROLE_SQL:-/usr/local/share/inboxui/least-privilege-roles.sql}"

die() {
  printf '[inboxui] ERROR: %s\n' "$*" >&2
  exit 1
}

require() {
  local name="$1"
  local value="${!name-}"
  [ -n "$value" ] || die "environment variable $name is required but empty. See deploy/runbooks/04-postgres-role-rotation.md"
}

[ -r "$SQL_FILE" ] || die "cannot read $SQL_FILE"

for var in POSTGRES_DB POSTGRES_USER \
           POSTGRES_APP_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_BACKUP_PASSWORD; do
  require "$var"
done

APP_ROLE="${POSTGRES_APP_USER:-inboxui_app}"
MIGRATOR_ROLE="${POSTGRES_MIGRATOR_USER:-inboxui_migrator}"
BACKUP_ROLE="${POSTGRES_BACKUP_USER:-inboxui_backup}"

# A least-privileged role that collides with the bootstrap superuser would be a
# no-op at best and would hand the app superuser at worst. Refuse.
for role in "$APP_ROLE" "$MIGRATOR_ROLE" "$BACKUP_ROLE"; do
  [ "$role" != "$POSTGRES_USER" ] \
    || die "role '$role' collides with the bootstrap superuser POSTGRES_USER. Pick a different name."
done
[ "$APP_ROLE" != "$MIGRATOR_ROLE" ] || die "app and migrator roles must differ"
[ "$APP_ROLE" != "$BACKUP_ROLE" ]   || die "app and backup roles must differ"
[ "$MIGRATOR_ROLE" != "$BACKUP_ROLE" ] || die "migrator and backup roles must differ"

# Secrets are handed to psql through a 0600 temp file of \set commands rather
# than `psql -v name=value`, so they never appear in the process table.
VARS_FILE="$(umask 077 && mktemp "${TMPDIR:-/tmp}/inboxui-pgvars.XXXXXX")"
trap 'rm -f "$VARS_FILE"' EXIT

# psql's \set takes a single-quoted literal; double any embedded single quote.
sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

{
  printf "\\set db_name '%s'\n"            "$(sql_literal "$POSTGRES_DB")"
  printf "\\set bootstrap_role '%s'\n"     "$(sql_literal "$POSTGRES_USER")"
  printf "\\set migrator_role '%s'\n"      "$(sql_literal "$MIGRATOR_ROLE")"
  printf "\\set app_role '%s'\n"           "$(sql_literal "$APP_ROLE")"
  printf "\\set backup_role '%s'\n"        "$(sql_literal "$BACKUP_ROLE")"
  printf "\\set migrator_password '%s'\n"  "$(sql_literal "$POSTGRES_MIGRATOR_PASSWORD")"
  printf "\\set app_password '%s'\n"       "$(sql_literal "$POSTGRES_APP_PASSWORD")"
  printf "\\set backup_password '%s'\n"    "$(sql_literal "$POSTGRES_BACKUP_PASSWORD")"
} > "$VARS_FILE"

# During initdb the temp server listens on the unix socket only, so that is the
# default. The operator wrapper overrides PGHOST to 127.0.0.1.
export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"

printf '[inboxui] applying %s to database %s as %s\n' "$SQL_FILE" "$POSTGRES_DB" "$POSTGRES_USER"

psql \
  --no-psqlrc \
  --no-password \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --file "$VARS_FILE" \
  --file "$SQL_FILE"
