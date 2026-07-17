-- Schema review MEDIUM findings — indexes, timestamps, type standardization.
-- F9  partial sweeper index      F16 timestamp -> timestamptz(3)
-- F10 FK indexes (org/user)      F17 AutoReplyLedger timestamps
-- F11 drop redundant indexes     F20 webhook org index
-- F14 partial OTP index          F26 drop dead indexes
-- F15 EmailMessage.updatedAt
--
-- Hand-finished from `prisma migrate diff`: the generated version (a) converted
-- timestamp -> timestamptz without a USING clause, so values would shift by the
-- session's UTC offset instead of being read as the UTC they were stored as;
-- and (b) added the two new `updatedAt` columns as NOT NULL with no default,
-- which fails on a non-empty table. Both are corrected below.

-- DropIndex
DROP INDEX "api_keys_prefix_idx";
-- DropIndex
DROP INDEX "email_job_dead_letter_inboxEmailAddressId_idx";
-- DropIndex
DROP INDEX "email_messages_externalId_idx";
-- DropIndex
DROP INDEX "email_messages_inboxEmailAddressId_extractedOtp_createdAt_idx";
-- DropIndex
DROP INDEX "email_messages_messageId_idx";
-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "revokedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastUsedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "lastUsedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "auto_reply_ledgers" ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3),
ALTER COLUMN "lastSentAt" SET DATA TYPE TIMESTAMPTZ(3) USING "lastSentAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "automation_node_runs" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "finishedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "finishedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "automation_revisions" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "automation_runs" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "finishedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "finishedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "automations" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
-- AlterTable
-- No USING clause here: last_success_at is ALREADY timestamptz (original
-- 20260514222211 migration), so this is a precision-only change. Applying
-- `AT TIME ZONE 'UTC'` would convert it to a naive timestamp and reinterpret it
-- in the session TZ, shifting the stored instant on any non-UTC session.
ALTER TABLE "backup_status" ALTER COLUMN "last_success_at" SET DATA TYPE TIMESTAMPTZ(3);
-- AlterTable
ALTER TABLE "email_attachments" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "email_inboxes" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "email_job_dead_letter" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "updatedAt" TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "phone_inboxes" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "users" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "webhook_events" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deliveredAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deliveredAt" AT TIME ZONE 'UTC';
-- AlterTable
ALTER TABLE "webhooks" ALTER COLUMN "lastTriggered" SET DATA TYPE TIMESTAMPTZ(3) USING "lastTriggered" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
-- CreateIndex
CREATE INDEX "email_inboxes_organizationId_idx" ON "email_inboxes"("organizationId");
-- CreateIndex
CREATE INDEX "email_inboxes_userId_idx" ON "email_inboxes"("userId");
-- CreateIndex
CREATE INDEX "phone_inboxes_organizationId_idx" ON "phone_inboxes"("organizationId");
-- CreateIndex
CREATE INDEX "phone_inboxes_userId_idx" ON "phone_inboxes"("userId");
-- CreateIndex
CREATE INDEX "webhooks_organizationId_idx" ON "webhooks"("organizationId");

-- Backfill the new updatedAt columns to createdAt, then enforce NOT NULL
-- (F15, F17). Kept out of the ADD COLUMN so existing rows don't violate it.
UPDATE "email_messages"    SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "email_messages"    ALTER COLUMN "updatedAt" SET NOT NULL;

-- auto_reply_ledgers.createdAt was just added with a CURRENT_TIMESTAMP default,
-- which would stamp every pre-existing row at migration time. lastSentAt is the
-- best historical signal for when the ledger row began, so seed createdAt from
-- it (only existing rows are present during the migration). updatedAt then
-- follows createdAt.
UPDATE "auto_reply_ledgers" SET "createdAt" = "lastSentAt";
UPDATE "auto_reply_ledgers" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "auto_reply_ledgers" ALTER COLUMN "updatedAt" SET NOT NULL;

-- F14: partial OTP index, replacing the dropped 3-col index. Partial because
-- Prisma's schema cannot express a WHERE predicate. It skips the majority of
-- rows that carry no OTP and keeps createdAt usable for ORDER BY (the old index
-- could not, because extractedOtp sat between the equality and sort columns as
-- an IS-NOT-NULL range).
CREATE INDEX "email_messages_inbox_otp_partial_idx"
  ON "email_messages" ("inboxEmailAddressId", "createdAt" DESC)
  WHERE "extractedOtp" IS NOT NULL;

-- F9: partial index for the stuck-run sweeper, which filters
-- status IN ('queued','running') AND startedAt < cutoff. Only in-flight rows
-- are indexed, so it stays negligible on a high-growth table.
CREATE INDEX "automation_runs_status_startedat_partial_idx"
  ON "automation_runs" ("status", "startedAt")
  WHERE "status" IN ('queued', 'running');
