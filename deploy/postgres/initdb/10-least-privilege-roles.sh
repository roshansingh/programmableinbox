#!/usr/bin/env bash
# ===========================================================================
# /docker-entrypoint-initdb.d hook.
#
# ⚠️  THE OFFICIAL POSTGRES IMAGE RUNS THIS FILE **ONLY WHEN PGDATA IS EMPTY**.
#     Bringing a new image up on an existing /srv/inboxui/pgdata volume does
#     NOT re-run it, and no warning is printed. Converting a cluster that is
#     already initialised is a deliberate operator action:
#
#         deploy/scripts/pg-apply-least-privilege.sh
#
#     Runbook: deploy/runbooks/04-postgres-role-rotation.md
#
# Note also that `backup_status` does not exist yet at first init (it is created
# by `prisma migrate deploy`), so the backup role's write grant on it is skipped
# here. Re-run the operator script once after the first migrate.
# ===========================================================================
set -euo pipefail

echo "[inboxui] initdb hook: creating least-privileged roles"
exec /usr/local/bin/inboxui-apply-least-privilege
