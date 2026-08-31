# Runbook 05 — Migrate an existing deployment from `inboxui` to `programmableinbox`

**Applies to**: the current production host, which still runs under the pre-PR-#159
names — `/srv/inboxui`, Compose project `inboxui`, and Postgres roles
`inboxui_app`/`inboxui_migrator`/`inboxui_backup`.

**Not needed for**: a brand-new deployment following the current `deploy/README.md` —
every path there already reads `programmableinbox`.

**Expected duration**: 20–30 minutes of prep with **zero downtime**, then a single
coordinated cutover window of roughly 1–2 minutes (the whole stack restarts together).

**Risk**: medium. No data is dropped, copied, or recreated at any point — `pgdata` is a
bind mount that survives its parent directory being renamed, and Postgres roles are
renamed in place (`ALTER ROLE ... RENAME TO`), never dropped and re-created. The risk is
entirely in cutover ordering; rollback at every stage is "point the same data at the
old names again," not a restore from backup.

---

## Why this needs a manual procedure

PR #159 renamed the identifiers Docker Compose actually uses to run the stack: the
project name (`inboxui` → `programmableinbox`), every service's network, the
`/srv/inboxui` host path baked into every `env_file`/volume entry, and the three
Postgres role names. None of that migrates itself on a routine deploy —
`deploy.yml`'s SSH step opens with `cd /srv/programmableinbox`, which doesn't exist on
this host yet. **Merging PR #159 without doing this first does not take production
down** (that `cd` just fails and the script exits before touching any container,
thanks to `set -euo pipefail`) — it only leaves deploys blocked until this runbook is
done.

## What does and doesn't need downtime

| Identifier | Rename mechanism | Downtime? |
|---|---|---|
| `/srv/inboxui` → `/srv/programmableinbox` | `mv` (same filesystem) | None — a bind mount is resolved to an inode at mount time, not re-resolved by path, so running containers keep writing through it after the source directory is renamed underneath them |
| Postgres roles (`inboxui_app` etc.) | `ALTER ROLE ... RENAME TO ...` | None — renaming a role doesn't drop existing sessions, only changes what name *future* connections authenticate as |
| Compose project name / network | New `docker compose -p` project | Yes — every service must join the new `programmableinbox-internal` network, so the whole stack cycles together |
| Postgres **database** name (`inboxui`) | `ALTER DATABASE ... RENAME TO ...` | Requires zero other connections — optional, see Phase D |
| `caddy-data` / `caddy-config` / `otel-collector-storage` | Nothing — these already carry explicit fixed `name:` values in the compose file | None |

---

## Phase A — Prep (zero downtime; do this any time before the cutover)

### 1. Get the renamed deploy files onto the box

```bash
ssh deploy@$HOST
git clone https://github.com/roshansingh/programmableinbox /tmp/programmableinbox
# before PR #159 merges: git clone -b rename/inboxui-to-programmableinbox https://github.com/roshansingh/programmableinbox /tmp/programmableinbox
```

### 2. Rename the Postgres roles (live)

`$POSTGRES_USER`/`$POSTGRES_DB` live only inside the containers, via `env_file` —
they are not set in your SSH shell. Pull them out of `app.env` once; every `psql`
invocation below (and in Phase B/D) relies on them being set for the rest of the
session:

```bash
cd /srv/inboxui   # still the old path — the running stack is untouched by this step
export POSTGRES_USER=$(grep -m1 '^POSTGRES_USER=' secrets/app.env | cut -d= -f2-)
export POSTGRES_DB=$(grep -m1 '^POSTGRES_DB=' secrets/app.env | cut -d= -f2-)

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
ALTER ROLE inboxui_app RENAME TO programmableinbox_app;
ALTER ROLE inboxui_migrator RENAME TO programmableinbox_migrator;
ALTER ROLE inboxui_backup RENAME TO programmableinbox_backup;
SQL
```

Don't run `deploy/scripts/pg-apply-least-privilege.sh` between this step and Phase B —
against the still-running old stack it would recreate a fresh, empty-grant
`inboxui_app` role rather than recognize the rename.

### 3. Rename the host directory

```bash
sudo mv /srv/inboxui /srv/programmableinbox
```

### 4. Copy the renamed deploy files into place

```bash
sudo cp /tmp/programmableinbox/deploy/docker-compose.yml /srv/programmableinbox/
sudo cp /tmp/programmableinbox/deploy/otel-collector.yaml /srv/programmableinbox/   # only if observability is enabled
sudo cp /tmp/programmableinbox/deploy/scripts/pg-apply-least-privilege.sh /srv/programmableinbox/
sudo chown deploy:deploy /srv/programmableinbox/pg-apply-least-privilege.sh
sudo chmod +x /srv/programmableinbox/pg-apply-least-privilege.sh
```

Leave `docker-compose.override.yml`, `Caddyfile`, and `.env` (the compose
variable-substitution file, not `secrets/app.env`) where they are — none of them
reference the old names:

```bash
grep -i inboxui /srv/programmableinbox/Caddyfile /srv/programmableinbox/docker-compose.override.yml /srv/programmableinbox/.env
# expect no output
```

### 5. Update `secrets/app.env`

```bash
sudo -u deploy vi /srv/programmableinbox/secrets/app.env
```

Update only the role names and the URLs' usernames. **Leave `POSTGRES_DB` and the
database name in both URLs alone** — that's Phase D, optional:

```diff
-DATABASE_URL=postgresql://inboxui_app:<app-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
-MIGRATE_DATABASE_URL=postgresql://inboxui_migrator:<migrator-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
+DATABASE_URL=postgresql://programmableinbox_app:<app-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
+MIGRATE_DATABASE_URL=postgresql://programmableinbox_migrator:<migrator-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
...
-POSTGRES_APP_USER=inboxui_app
-POSTGRES_MIGRATOR_USER=inboxui_migrator
-POSTGRES_BACKUP_USER=inboxui_backup
+POSTGRES_APP_USER=programmableinbox_app
+POSTGRES_MIGRATOR_USER=programmableinbox_migrator
+POSTGRES_BACKUP_USER=programmableinbox_backup
```

Passwords are untouched — a role rename doesn't invalidate them. If observability is
enabled and `secrets/otel-collector.env` pins `OTEL_SERVICE_NAME=inboxui` rather than
leaving it on the default, update that too.

### 6. Pull the new images

```bash
cd /srv/programmableinbox
docker compose pull
```

Nothing is recreated yet — this only warms the image cache so Phase B is fast. Stop
here until you're ready for the cutover window; nothing so far has touched a running
container.

---

## Phase B — Cutover (downtime: ~1–2 minutes, full stack restart)

### 7. Stop the old project

```bash
docker compose -p inboxui down
```

`down` without `-v` never touches bind mounts — `pgdata`, `redis`, `backup-logs`, and
`secrets` all live under the now-renamed `/srv/programmableinbox`, outside Docker's
view. The named volumes (`caddy-data`, `caddy-config`, `otel-collector-storage`) carry
explicit fixed names, so TLS certificates and OTel state survive regardless of which
project references them.

### 8. Bring up the new project

```bash
cd /srv/programmableinbox
docker compose up -d
docker compose ps   # wait for everything healthy
```

### 9. Verify

```bash
curl -fsS https://$DOMAIN/api/healthz | jq           # expect db: ok, redis: ok
docker compose logs --tail=50 app | grep -i error     # expect nothing
docker compose run --rm migrate                       # expect "No pending migrations to apply."
```

Confirm the role rename actually took, not just that the app happens to work. If
Phase B is a new shell session, re-export `$POSTGRES_USER`/`$POSTGRES_DB` from
`secrets/app.env` first (see step 2):

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT usename FROM pg_stat_activity WHERE datname = current_database();"
```

Expect `programmableinbox_app` rows (and `programmableinbox_backup` once
`backup-cron` next runs) — no `inboxui_*` rows.

---

## Phase C — Unblock CI

Merge PR #159 if it isn't already. The next push to `main` runs `deploy.yml` against a
server whose paths, roles, and project name now match, so the routine deploy
(`cd /srv/programmableinbox && docker compose pull app migrate && docker compose run
--rm migrate && docker compose up -d --no-deps app caddy`) works exactly as before.

---

## Phase D — Optional: rename the database itself

`POSTGRES_DB=inboxui` is cosmetic — nothing in the app requires the database name to
match the project name; `DATABASE_URL` is entirely operator-defined. Skip this unless
full naming consistency matters to you; it's the one step here that needs an actual
connection drain.

```bash
docker compose stop app migrate backup-cron    # postgres and redis stay up
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "ALTER DATABASE inboxui RENAME TO programmableinbox;"
```

Then update `POSTGRES_DB` and the database name in both URLs in `secrets/app.env`, and:

```bash
docker compose up -d --no-deps --force-recreate app backup-cron
docker compose run --rm migrate
```

---

## Rollback

Before starting, snapshot the pre-rename compose file so a rollback doesn't depend on
network access to GitHub:

```bash
cp /srv/inboxui/docker-compose.yml /tmp/docker-compose.yml.pre-rename
```

**Before step 7** (old project still running): nothing to roll back. Phase A only
copies files and renames a directory/roles the still-running `inboxui` project never
re-reads — env vars are loaded once, at container start, not re-resolved from disk.
Do not recreate any container under the old project between steps 3 and 7 without
first restoring the path (`sudo mv /srv/programmableinbox /srv/inboxui`).

**Step 7 succeeded but step 8 fails or the app won't go healthy**:

```bash
sudo mv /srv/programmableinbox /srv/inboxui
cd /srv/inboxui
cp /tmp/docker-compose.yml.pre-rename docker-compose.yml
docker compose -p inboxui up -d
```

Then revert the role names, since the restored `app.env` still authenticates as the
old names:

```sql
ALTER ROLE programmableinbox_app RENAME TO inboxui_app;
ALTER ROLE programmableinbox_migrator RENAME TO inboxui_migrator;
ALTER ROLE programmableinbox_backup RENAME TO inboxui_backup;
```

**After step 8 succeeds**: reverse Phase A/B — stop the new project, `mv` the
directory and `ALTER ROLE` back, bring the old project up from
`/tmp/docker-compose.yml.pre-rename`.

No step in this runbook drops or recreates data, so there is no restore-from-backup
path here — rollback is always "point the same `pgdata` at differently-named
roles/paths," at any point.
