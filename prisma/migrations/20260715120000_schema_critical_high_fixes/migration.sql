-- Schema review 2026-07-12: CRITICAL + HIGH findings.
-- F1 (email uniqueness), F4/F25 (hot-path indexes), F5 (API key lifecycle),
-- F6 (role enum), F7 (tenant-consistency FKs), F8 (soft delete).
--
-- Hand-written rather than taken verbatim from `prisma migrate diff`: the
-- generated version dropped and recreated memberships.role (losing every
-- existing role) and added api_keys.updatedAt as NOT NULL with no default
-- (which fails outright on a non-empty table). Both are corrected below.

-- ---------------------------------------------------------------------------
-- Pre-flight guards.
--
-- Each guard fails the migration loudly instead of letting it corrupt or
-- silently drop data. If one fires, fix the data and re-run — do not weaken
-- the guard.
-- ---------------------------------------------------------------------------

-- F1: duplicate addresses make the unique index impossible. They also mean
-- inbound mail is *currently* being written into more than one org's inbox,
-- so a hit here is an active cross-tenant exposure, not just a migration
-- blocker. Dedupe deliberately requires a human: picking the rightful owner
-- of an address is not a decision a migration should make.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(email, ', ') INTO dupes
  FROM (SELECT email FROM email_inboxes GROUP BY email HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'F1 blocked: duplicate email_inboxes.email values must be deduped first: %', dupes;
  END IF;
END $$;

-- F6: any role outside the enum would be silently discarded by the cast below.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT role, ', ') INTO bad
  FROM memberships
  WHERE role NOT IN ('owner', 'admin', 'member', 'viewer');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'F6 blocked: memberships.role values outside enum Role: %', bad;
  END IF;
END $$;

-- F7: pre-existing tenant drift would make the composite FKs unaddable. A hit
-- here means rows already reference a parent in a different org.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM email_messages m
  JOIN email_inboxes i ON i.id = m."inboxEmailAddressId"
  WHERE m."organizationId" <> i."organizationId";
  IF n > 0 THEN
    RAISE EXCEPTION
      'F7 blocked: % email_messages rows whose organizationId != their inbox''s org', n;
  END IF;

  SELECT count(*) INTO n
  FROM automation_runs r
  JOIN automations a ON a.id = r."automationId"
  WHERE r."organizationId" <> a."organizationId";
  IF n > 0 THEN
    RAISE EXCEPTION
      'F7 blocked: % automation_runs rows whose organizationId != their automation''s org', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- F6 — Membership.role: free text + `owner` default -> enum, no default.
--
-- Cast in place. Dropping the default first is the point of the finding: a
-- membership created without an explicit role must no longer become an owner.
-- ---------------------------------------------------------------------------
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'member', 'viewer');

ALTER TABLE "memberships" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";

-- ---------------------------------------------------------------------------
-- F5 — API key lifecycle.
--
-- Added nullable, then backfilled, then tightened: `updatedAt` is NOT NULL in
-- the datamodel but has no DB-level default (Prisma sets it client-side), so
-- it cannot be added as NOT NULL to a table that already has rows.
--
-- Deliberately NOT done here (deferred, needs prod verification):
--   - dropping the legacy plaintext `apiKey` column
--   - making `keyHash` NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE "api_keys"
  ADD COLUMN "expiresAt"  TIMESTAMP(3),
  ADD COLUMN "revokedAt"  TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt"  TIMESTAMP(3);

UPDATE "api_keys" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "api_keys" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- F8 — soft delete.
-- ---------------------------------------------------------------------------
ALTER TABLE "email_inboxes"  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "email_messages" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "phone_inboxes"  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "automations"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "webhooks"       ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- F1 — global uniqueness on the inbox address.
--
-- Covers soft-deleted rows on purpose: a deleted inbox keeps its address
-- claimed, so it can never be reclaimed by another org.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "email_inboxes_email_key" ON "email_inboxes"("email");

-- ---------------------------------------------------------------------------
-- F7 — tenant consistency enforced by the database.
--
-- The composite FK makes it structurally impossible for a row to reference a
-- parent in one org while carrying another org's id. These unique constraints
-- exist only to serve as FK targets (Postgres requires a unique constraint on
-- referenced columns); `id` alone is already the PK.
--
-- The single-column FKs are replaced, not supplemented — the composite FK is
-- strictly stronger and subsumes them.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "email_inboxes_id_organizationId_key" ON "email_inboxes"("id", "organizationId");
CREATE UNIQUE INDEX "automations_id_organizationId_key"   ON "automations"("id", "organizationId");

ALTER TABLE "email_messages"  DROP CONSTRAINT "email_messages_inboxEmailAddressId_fkey";
ALTER TABLE "automation_runs" DROP CONSTRAINT "automation_runs_automationId_fkey";

-- NOTE for large deployments: these validate the whole table under an
-- ACCESS EXCLUSIVE lock. On a big email_messages, split into
-- `ADD CONSTRAINT ... NOT VALID` + a separate `VALIDATE CONSTRAINT` run
-- outside a transaction. Kept as single statements here because Prisma wraps
-- migrations in a transaction, which would negate the split anyway.
ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_inboxEmailAddressId_organizationId_fkey"
  FOREIGN KEY ("inboxEmailAddressId", "organizationId")
  REFERENCES "email_inboxes"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_automationId_organizationId_fkey"
  FOREIGN KEY ("automationId", "organizationId")
  REFERENCES "automations"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- F25 — ingest subject-fallback scan.
-- F4  — webhook_events had no indexes at all, not even on its FK.
-- ---------------------------------------------------------------------------
CREATE INDEX "email_messages_inboxEmailAddressId_subject_idx"
  ON "email_messages"("inboxEmailAddressId", "subject");

CREATE INDEX "webhook_events_webhookId_createdAt_idx"
  ON "webhook_events"("webhookId", "createdAt");
CREATE INDEX "webhook_events_webhookId_status_createdAt_idx"
  ON "webhook_events"("webhookId", "status", "createdAt");
