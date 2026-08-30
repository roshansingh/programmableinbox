-- ===========================================================================
-- programmableinbox — least-privileged Postgres role model
-- ===========================================================================
--
-- Applied two ways, both of which run THIS file so there is exactly one source
-- of truth:
--
--   1. First-time cluster init — deploy/postgres/initdb/10-least-privilege-roles.sh
--      is placed in /docker-entrypoint-initdb.d and runs it automatically.
--      ⚠️  The official postgres image only runs /docker-entrypoint-initdb.d/*
--          when PGDATA is EMPTY. On an existing volume nothing happens.
--
--   2. Existing clusters — deploy/scripts/pg-apply-least-privilege.sh, which
--      execs the same wrapper inside the running postgres container.
--      See deploy/runbooks/04-postgres-role-rotation.md.
--
-- The file is written to be IDEMPOTENT: safe to re-run against a cluster that
-- is already converted, and safe to re-run after every schema migration.
--
-- Roles created (names are overridable, see the wrapper script):
--
--   <bootstrap>          POSTGRES_USER — superuser created by the image
--                        entrypoint. Break-glass only. Nothing connects as it.
--   programmableinbox_migrator     Owns schema `public` and every object in it. Runs DDL.
--                        Used ONLY by the one-shot `migrate` compose service.
--                        NOSUPERUSER / NOCREATEDB / NOCREATEROLE.
--   programmableinbox_app          Runtime role for the Next.js app. DML only
--                        (SELECT/INSERT/UPDATE/DELETE) plus USAGE on sequences.
--                        Cannot create, drop or alter anything.
--   programmableinbox_backup       pg_dump / wal-g. Read-only via the predefined
--                        pg_read_all_data role, plus the specific backup
--                        functions and write access to `backup_status` only.
--
-- psql variables this file expects (set by the wrapper, never hard-coded here):
--   db_name, bootstrap_role,
--   app_role, app_password,
--   migrator_role, migrator_password,
--   backup_role, backup_password
-- ===========================================================================

\set ON_ERROR_STOP on

\echo '[programmableinbox] applying least-privileged role model'

-- ---------------------------------------------------------------------------
-- 1. Roles
--
-- CREATE ROLE is not idempotent, so it is emitted through \gexec only when the
-- role is missing. Attributes and password are then (re)asserted unconditionally
-- — re-running this file is also how you rotate the passwords.
-- ---------------------------------------------------------------------------

SELECT format('CREATE ROLE %I NOLOGIN', :'migrator_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role')
\gexec

SELECT format('CREATE ROLE %I NOLOGIN', :'app_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

SELECT format('CREATE ROLE %I NOLOGIN', :'backup_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'backup_role')
\gexec

ALTER ROLE :"migrator_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'migrator_password';

ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'app_password';

ALTER ROLE :"backup_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'backup_password';

-- Pin the session timezone per role as well as per connection string. The
-- DATABASE_URL `options=-c timezone=UTC` is still required (see CLAUDE.md), but
-- this closes the gap for psql / pg_dump sessions that do not carry it.
ALTER ROLE :"migrator_role" SET timezone TO 'UTC';
ALTER ROLE :"app_role"      SET timezone TO 'UTC';
ALTER ROLE :"backup_role"   SET timezone TO 'UTC';

-- ---------------------------------------------------------------------------
-- 2. Database-level privileges
--
-- PUBLIC gets CONNECT + TEMPORARY on every new database by default; revoke it
-- so only the three named roles (and superusers) can reach the database at all.
-- ---------------------------------------------------------------------------

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;

GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
GRANT CONNECT ON DATABASE :"db_name" TO :"backup_role";
-- CREATE on the database lets the migrator install *trusted* extensions
-- (pgcrypto is trusted since PG13) and create schemas. It does NOT let it drop
-- the database — that requires ownership, which stays with the bootstrap role.
GRANT CONNECT, CREATE ON DATABASE :"db_name" TO :"migrator_role";

-- ---------------------------------------------------------------------------
-- 3. Extensions
--
-- prisma/migrations/.../migration.sql runs `CREATE EXTENSION IF NOT EXISTS
-- pgcrypto`. pgcrypto is a *trusted* extension on PG13+, so the migrator could
-- install it itself given CREATE on the database — but installing it here, as
-- the bootstrap superuser, means the statement in the migration is always a
-- no-op and the extension is never owned by a non-superuser. If a future
-- migration needs an UNtrusted extension, add it here; it will not work from
-- the migrate service.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 4. Schema ownership and privileges
--
-- On PG15+ `public` is owned by the pseudo-role pg_database_owner and PUBLIC no
-- longer holds CREATE on it, so some of this is already the default on a fresh
-- 17 cluster. It is asserted anyway because it is NOT the default on a cluster
-- that was pg_upgrade'd or restored from a pre-15 dump.
-- ---------------------------------------------------------------------------

ALTER SCHEMA public OWNER TO :"migrator_role";

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL   ON SCHEMA public TO :"migrator_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"backup_role";

-- ---------------------------------------------------------------------------
-- 5. Re-own pre-existing objects
--
-- Only relevant when converting a cluster whose tables were created by the old
-- superuser. `ALTER TABLE` / `DROP` in a future migration require *ownership*,
-- so without this step `prisma migrate deploy` would fail as the migrator on
-- every table it did not create itself.
--
-- Objects owned by an extension (pg_depend deptype 'e') are skipped — those
-- belong to the extension and must stay with the installing superuser.
-- ---------------------------------------------------------------------------

SELECT format('ALTER %s public.%I OWNER TO %I',
              CASE c.relkind
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                WHEN 'f' THEN 'FOREIGN TABLE'
                ELSE 'TABLE'
              END,
              c.relname, :'migrator_role')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
   AND pg_get_userbyid(c.relowner) <> :'migrator_role'
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype = 'e')
   -- sequences owned by a table follow their table's owner automatically
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype = 'a')
\gexec

-- User-defined types (Prisma enums land here).
SELECT format('ALTER TYPE public.%I OWNER TO %I', t.typname, :'migrator_role')
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'public'
   AND pg_get_userbyid(t.typowner) <> :'migrator_role'
   AND (t.typrelid = 0
        OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c')
   AND NOT EXISTS (
         SELECT 1 FROM pg_type el
          WHERE el.oid = t.typelem AND el.typarray = t.oid)
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass
            AND d.objid = t.oid
            AND d.deptype = 'e')
\gexec

-- ---------------------------------------------------------------------------
-- 6. Catch-up grants on objects that already exist
--
-- Default privileges (section 7) only apply to objects created AFTER they are
-- set, so everything already in the schema needs an explicit grant once.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- ---------------------------------------------------------------------------
-- 7. Default privileges — the load-bearing part
--
-- Every migration creates new tables. Those tables are owned by the migrator
-- and, without this, the runtime role would have NO privileges on them: the
-- deploy would go green and the app would start throwing
-- `permission denied for table <new_table>` on the first request that touches
-- it. ALTER DEFAULT PRIVILEGES makes the grant automatic at CREATE time.
--
-- Default privileges are keyed on the CREATING role, which is why it is
-- mandatory that migrations run as the migrator and nothing else. The second
-- pair is a safety net for the case where an operator applies a migration by
-- hand as the bootstrap superuser.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"bootstrap_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"bootstrap_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- ---------------------------------------------------------------------------
-- 8. Backup role
--
-- pg_dump has to read every object, so a hand-rolled grant list is the wrong
-- tool — it silently misses each new table. PG14+ ships the predefined role
-- `pg_read_all_data`, which confers SELECT on all tables/views/sequences and
-- USAGE on all schemas, present and future, and nothing else. That is exactly
-- the privilege pg_dump needs and is what we use.
--
-- wal-g additionally needs to read GUCs (`data_directory`), read
-- pg_stat_archiver, and call the backup-control functions.
-- ---------------------------------------------------------------------------

GRANT pg_read_all_data     TO :"backup_role";
GRANT pg_read_all_settings TO :"backup_role";
GRANT pg_read_all_stats    TO :"backup_role";

-- Generated from the catalog rather than written literally so a signature
-- change between major versions cannot abort the script; a function that does
-- not exist simply produces no row.
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I',
              p.oid::regprocedure, :'backup_role')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pg_catalog'
   AND p.proname IN ('pg_backup_start',
                     'pg_backup_stop',
                     'pg_switch_wal',
                     'pg_create_restore_point',
                     'pg_control_checkpoint',
                     'pg_control_system')
\gexec

-- The backup scripts stamp their own success into `backup_status`; that is the
-- one table the backup role writes. The table is created by a migration, so on
-- a first-init run it does not exist yet and this is a no-op — re-run this file
-- after the first `docker compose run --rm migrate`.
SELECT format('GRANT SELECT, INSERT, UPDATE ON TABLE public.backup_status TO %I',
              :'backup_role')
 WHERE to_regclass('public.backup_status') IS NOT NULL
\gexec

-- ---------------------------------------------------------------------------
-- 9. Summary — read this output, it is the verification
-- ---------------------------------------------------------------------------

\echo ''
\echo '[programmableinbox] role attributes (rolsuper MUST be false for app/migrator/backup):'

SELECT rolname,
       rolsuper     AS superuser,
       rolcreatedb  AS createdb,
       rolcreaterole AS createrole,
       rolbypassrls AS bypassrls,
       rolcanlogin  AS login
  FROM pg_roles
 WHERE rolname IN (:'bootstrap_role', :'migrator_role', :'app_role', :'backup_role')
 ORDER BY rolsuper DESC, rolname;

\echo ''
\echo '[programmableinbox] least-privileged role model applied'
