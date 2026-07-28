# Runbook 04 — Rotate an existing deployment onto least-privileged Postgres roles

**Applies to**: any cluster brought up before the least-privilege role model landed (issue #41), i.e. one where `DATABASE_URL` connects as `POSTGRES_USER` and that role is a **superuser**.

**Not needed for**: a brand-new cluster created from an empty `pgdata` with the current postgres image — the image's initdb hook does all of this automatically. (Do still run step 8 once, after the first `migrate`.)

**Expected duration**: 15–20 minutes, of which ~2 minutes is app downtime.

**Risk**: medium. Everything is reversible — the old superuser keeps working throughout, so rollback is "put the old `DATABASE_URL` back".

---

## Why this is a manual procedure

The role model lives in `deploy/postgres/least-privilege-roles.sql`, which the postgres image installs into `/docker-entrypoint-initdb.d/`.

> ⚠️ **The official postgres image only executes `/docker-entrypoint-initdb.d/*` when `PGDATA` is empty.**
> Pulling the new image and recreating the container against the existing
> `/srv/inboxui/pgdata` runs **none** of it, and prints **no warning**. There is
> no automatic path. That is what this runbook is for.

## The target role model

| Role | Attributes | Privileges | Used by |
|---|---|---|---|
| `$POSTGRES_USER` (bootstrap) | SUPERUSER | everything; owns the database | image entrypoint + break-glass only |
| `inboxui_migrator` | NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS | owns schema `public` and every object in it; `CONNECT`+`CREATE` on the database | the one-shot `migrate` service (`prisma migrate deploy`) |
| `inboxui_app` | NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS | `USAGE` on `public`; `SELECT/INSERT/UPDATE/DELETE` on its tables; `USAGE,SELECT` on sequences; `CONNECT` on the database. **No DDL, no `COPY … PROGRAM`, no `pg_read_file`** | the `app` container |
| `inboxui_backup` | NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS | `pg_read_all_data`, `pg_read_all_settings`, `pg_read_all_stats`, EXECUTE on the backup-control functions, and `SELECT/INSERT/UPDATE` on `backup_status` only | `backup-cron` (`pg_dump`, `wal-g`) |

---

## 1. Generate three new passwords

```bash
for r in APP MIGRATOR BACKUP; do printf '%s=%s\n' "POSTGRES_${r}_PASSWORD" "$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"; done
```

Save all three in the password manager **now** — `app.env` is not the source of truth.

## 2. Add them to `app.env`

```bash
ssh deploy@$HOST
sudo -u deploy vi /srv/inboxui/secrets/app.env
```

Add (keep the existing `POSTGRES_USER` / `POSTGRES_PASSWORD` lines exactly as they are — the bootstrap superuser must keep working until rollback is off the table):

```bash
# --- least-privileged roles (issue #41) ---
POSTGRES_APP_PASSWORD=<generated>
POSTGRES_MIGRATOR_PASSWORD=<generated>
POSTGRES_BACKUP_PASSWORD=<generated>
# role names are optional; these are the defaults
POSTGRES_APP_USER=inboxui_app
POSTGRES_MIGRATOR_USER=inboxui_migrator
POSTGRES_BACKUP_USER=inboxui_backup
```

Do **not** repoint `DATABASE_URL` yet — that happens in step 5, after the roles exist.

## 3. Get the new postgres image onto the box

The conversion script ships inside the image, so the container has to be recreated first. Recreating the container does **not** touch `/srv/inboxui/pgdata`.

```bash
cd /srv/inboxui
docker compose pull postgres
docker compose up -d postgres
docker compose ps                       # wait for "healthy"
docker compose exec -T postgres test -x /usr/local/bin/inboxui-apply-least-privilege && echo OK
```

If that last check fails, CI has not published a postgres image containing this change yet. Stop here.

## 4. Create the roles

```bash
sudo cp /tmp/inboxui/deploy/scripts/pg-apply-least-privilege.sh /srv/inboxui/
sudo chown deploy:deploy /srv/inboxui/pg-apply-least-privilege.sh
sudo chmod +x /srv/inboxui/pg-apply-least-privilege.sh
sudo -u deploy /srv/inboxui/pg-apply-least-privilege.sh
```

This is idempotent — re-running it is safe and is also how you rotate the passwords later.

What it does, in order: creates the three roles; revokes `CONNECT`/`TEMPORARY` on the database from `PUBLIC`; makes `inboxui_migrator` the owner of schema `public` **and of every existing table, sequence, view and enum type in it**; revokes `CREATE` on `public` from `PUBLIC`; grants the runtime role DML on everything that exists today; sets `ALTER DEFAULT PRIVILEGES` so everything created by future migrations is covered automatically; and grants the backup role `pg_read_all_data`.

> The re-ownership step is not optional. `ALTER TABLE` requires *ownership*, not
> a privilege — without it the very next migration would fail on every table the
> migrator did not create itself.

### Verify before going further

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
-- 1. attributes: rolsuper must be f for all three
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
  FROM pg_roles WHERE rolname LIKE 'inboxui\_%' ORDER BY rolname;

-- 2. the runtime role can read/write the data ...
SELECT has_table_privilege('inboxui_app', 'public.email_messages', 'SELECT') AS sel,
       has_table_privilege('inboxui_app', 'public.email_messages', 'INSERT') AS ins,
       has_table_privilege('inboxui_app', 'public.email_messages', 'DELETE') AS del;

-- 3. ... but owns nothing (0 rows expected)
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'inboxui_app';

-- 4. the migrator owns everything (0 rows expected)
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m')
   AND pg_get_userbyid(c.relowner) <> 'inboxui_migrator';

-- 5. default privileges are recorded (expect one row per role/objtype)
SELECT pg_get_userbyid(defaclrole) AS grantor, defaclobjtype, defaclacl
  FROM pg_default_acl;

-- 6. PUBLIC can no longer connect or create
SELECT has_database_privilege('public', current_database(), 'CONNECT') AS pub_connect,
       has_schema_privilege('public', 'public', 'CREATE')              AS pub_create;
SQL
```

Expected: (1) `rolsuper` false everywhere; (2) all `t`; (3) and (4) empty; (5) rows for both the migrator and the bootstrap role; (6) both `f`.

Now prove the runtime role really cannot escalate — **this is the actual point of the change**:

```bash
docker compose exec -T postgres \
  env PGPASSWORD="$POSTGRES_APP_PASSWORD" \
  psql -h 127.0.0.1 -U inboxui_app -d "$POSTGRES_DB" <<'SQL'
-- each of these MUST fail
COPY (SELECT 1) TO PROGRAM 'id';           -- ERROR: must be superuser ...
SELECT pg_read_file('/etc/passwd');        -- ERROR: permission denied for function
CREATE TABLE should_not_exist (id int);    -- ERROR: permission denied for schema public
SQL
```

If any of those three **succeeds**, stop and do not proceed — the model has not been applied.

## 5. Repoint the application

Edit `/srv/inboxui/secrets/app.env` again:

```bash
# was: postgresql://app:<superuser-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
DATABASE_URL=postgresql://inboxui_app:<POSTGRES_APP_PASSWORD>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
MIGRATE_DATABASE_URL=postgresql://inboxui_migrator:<POSTGRES_MIGRATOR_PASSWORD>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
```

> Keep `?options=-c%20timezone%3DUTC` on **both** URLs. See `CLAUDE.md` — without
> it, raw-SQL readers see timestamps shifted by the session offset.
>
> If a password contains `@ : / ? # & %`, percent-encode it in the URL. Generating
> passwords with step 1's `tr -d '/+='` avoids the problem entirely.

`MIGRATE_DATABASE_URL` is now **required**: the `migrate` service refuses to start without it, so migrations can never silently fall back to the app role or the superuser.

## 6. Restart the app and the backup cron

```bash
cd /srv/inboxui
docker compose up -d --no-deps --force-recreate app backup-cron
docker compose logs --tail=50 app
curl -fsS https://$DOMAIN/api/healthz | jq      # expect db: ok
```

## 7. Prove migrations still work as the owner

```bash
docker compose run --rm migrate                 # no-op if schema is current
```

Expect `No pending migrations to apply.` and **no** permission errors.

## 8. Re-run the grant script once, after the first migrate

`backup_status` is created by a migration, so on a cluster whose roles were created before that table existed the backup role has no write grant on it yet. The script skips it silently in that case. Re-run it:

```bash
sudo -u deploy /srv/inboxui/pg-apply-least-privilege.sh
docker compose exec backup-cron /scripts/report-status.sh
tail -20 /srv/inboxui/backup-logs/cron.log       # no WARNING, no permission denied
```

## 9. Verify backups end to end

```bash
docker compose exec backup-cron /scripts/pgdump.sh
docker compose exec backup-cron /scripts/base-backup.sh
tail -40 /srv/inboxui/backup-logs/cron.log
```

`pg_dump` runs on `pg_read_all_data`, which covers current *and future* tables — no per-table grant maintenance. If `wal-g backup-push` reports a permission error on some function not in the grant list, add it to the `p.proname IN (...)` set in `deploy/postgres/least-privilege-roles.sql` rather than handing the role superuser.

## 10. Close the loop on the old superuser

Only once steps 5–9 are green and you are past the rollback window:

1. Rotate the bootstrap password — it was shared with the application for the whole life of the deployment and must be considered exposed:
   ```bash
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "ALTER ROLE \"$POSTGRES_USER\" PASSWORD '<new-superuser-pw>';"
   ```
   Then update `POSTGRES_PASSWORD` in `app.env` and the password manager, and `docker compose up -d --no-deps postgres`.
2. Confirm nothing still connects as it:
   ```bash
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "SELECT usename, application_name, client_addr FROM pg_stat_activity WHERE datname = current_database();"
   ```
   Only `inboxui_app` and `inboxui_backup` should appear.
3. Record the rotation in `deploy/runbooks/drill-log.md`.

Do **not** `ALTER ROLE … NOSUPERUSER` on the bootstrap role: the image entrypoint and every break-glass procedure in runbooks 02 and 03 depend on it. Its protection is that it is unreachable from outside the compose network and no service uses it.

---

## Rollback

At any point before step 10, revert in `app.env`:

```bash
DATABASE_URL=postgresql://$POSTGRES_USER:<superuser-pw>@postgres:5432/inboxui?options=-c%20timezone%3DUTC
```

and restart:

```bash
docker compose up -d --no-deps --force-recreate app backup-cron
```

The new roles can be left in place — they are inert when nothing authenticates as them. Two caveats, both harmless:

- Schema `public` and its objects are now owned by `inboxui_migrator`. The bootstrap superuser retains full access regardless of ownership, so `migrate` and the app both keep working when pointed back at it.
- `PUBLIC` no longer has `CONNECT` on the database. Any *other* tool that relied on an unnamed role would need an explicit `GRANT CONNECT`. Nothing in this stack does.

To undo the ownership change as well:

```sql
ALTER SCHEMA public OWNER TO pg_database_owner;
GRANT CONNECT ON DATABASE inboxui TO PUBLIC;
```

then re-own the relations back with the inverse of the loop in `least-privilege-roles.sql`.

---

## After a database restore

- **PITR / `wal-g backup-fetch` (runbooks 02 and 03)** — roles are cluster-global and are included in a physical base backup, so they come back with the restore. Nothing to do. The `docker compose up -d postgres` in those runbooks does trigger initdb against the empty volume first, but `backup-fetch` then replaces that cluster wholesale.
- **Logical restore from the restic `pg_dump`** — the dump is taken with `--no-owner --no-privileges`, so ownership and grants are **not** in it. After restoring, run `/srv/inboxui/pg-apply-least-privilege.sh` again to re-establish the whole model, then step 8.
