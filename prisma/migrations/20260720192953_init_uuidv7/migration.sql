-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('active', 'inactive', 'failing');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'partial', 'skipped');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_inboxes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_inboxes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "phone_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "apiKey" TEXT,
    "keyHash" TEXT,
    "prefix" TEXT,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT[],
    "bcc" TEXT[],
    "cc" TEXT[],
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "externalId" TEXT NOT NULL,
    "inboxEmailAddressId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "parentMessageId" UUID,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractedOtp" TEXT,
    "metadata" JSONB,
    "dispatchedAt" TIMESTAMPTZ(3),
    "enrichedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "organizationId" UUID NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'active',
    "secret" TEXT,
    "lastTriggered" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inboxId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeRevisionId" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_revisions" (
    "id" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "layout" JSONB,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "automationRevisionId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "emailMessageId" UUID,
    "triggerType" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "inputSnapshot" JSONB NOT NULL,
    "error" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_node_runs" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "configNodeId" TEXT NOT NULL,
    "configNodeType" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "branchTaken" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "automation_node_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_job_dead_letter" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "inboxEmailAddressId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_job_dead_letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" UUID NOT NULL,
    "emailMessageId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_reply_ledgers" (
    "id" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "inboxId" UUID NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "lastSentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auto_reply_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_status" (
    "job_name" TEXT NOT NULL,
    "last_success_at" TIMESTAMPTZ(3) NOT NULL,
    "details" JSONB,

    CONSTRAINT "backup_status_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_organizationId_key" ON "memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "email_inboxes_email_key" ON "email_inboxes"("email");

-- CreateIndex
CREATE INDEX "email_inboxes_organizationId_idx" ON "email_inboxes"("organizationId");

-- CreateIndex
CREATE INDEX "email_inboxes_userId_idx" ON "email_inboxes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_inboxes_id_organizationId_key" ON "email_inboxes"("id", "organizationId");

-- CreateIndex
CREATE INDEX "phone_inboxes_organizationId_idx" ON "phone_inboxes"("organizationId");

-- CreateIndex
CREATE INDEX "phone_inboxes_userId_idx" ON "phone_inboxes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_apiKey_key" ON "api_keys"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_createdAt_idx" ON "api_keys"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "api_keys_userId_createdAt_idx" ON "api_keys"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_messageId_key" ON "email_messages"("messageId");

-- CreateIndex
CREATE INDEX "email_messages_inboxEmailAddressId_createdAt_id_idx" ON "email_messages"("inboxEmailAddressId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "email_messages_inboxEmailAddressId_threadId_createdAt_id_idx" ON "email_messages"("inboxEmailAddressId", "threadId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "email_messages_organizationId_idx" ON "email_messages"("organizationId");

-- CreateIndex
CREATE INDEX "email_messages_threadId_idx" ON "email_messages"("threadId");

-- CreateIndex
CREATE INDEX "email_messages_parentMessageId_idx" ON "email_messages"("parentMessageId");

-- CreateIndex
CREATE INDEX "email_messages_categories_idx" ON "email_messages" USING GIN ("categories");

-- CreateIndex
CREATE INDEX "email_messages_inboxEmailAddressId_subject_idx" ON "email_messages"("inboxEmailAddressId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_externalId_inboxEmailAddressId_key" ON "email_messages"("externalId", "inboxEmailAddressId");

-- CreateIndex
CREATE INDEX "webhooks_organizationId_idx" ON "webhooks"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_events_webhookId_createdAt_idx" ON "webhook_events"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_webhookId_status_createdAt_idx" ON "webhook_events"("webhookId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automations_activeRevisionId_key" ON "automations"("activeRevisionId");

-- CreateIndex
CREATE INDEX "automations_organizationId_idx" ON "automations"("organizationId");

-- CreateIndex
CREATE INDEX "automations_inboxId_idx" ON "automations"("inboxId");

-- CreateIndex
CREATE UNIQUE INDEX "automations_id_organizationId_key" ON "automations"("id", "organizationId");

-- CreateIndex
CREATE INDEX "automation_revisions_automationId_idx" ON "automation_revisions"("automationId");

-- CreateIndex
CREATE INDEX "automation_revisions_createdByUserId_idx" ON "automation_revisions"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "automation_revisions_automationId_revision_key" ON "automation_revisions"("automationId", "revision");

-- CreateIndex
CREATE INDEX "automation_runs_automationId_idx" ON "automation_runs"("automationId");

-- CreateIndex
CREATE INDEX "automation_runs_automationRevisionId_idx" ON "automation_runs"("automationRevisionId");

-- CreateIndex
CREATE INDEX "automation_runs_organizationId_idx" ON "automation_runs"("organizationId");

-- CreateIndex
CREATE INDEX "automation_runs_emailMessageId_idx" ON "automation_runs"("emailMessageId");

-- CreateIndex
CREATE INDEX "automation_node_runs_runId_idx" ON "automation_node_runs"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "email_job_dead_letter_externalId_inboxEmailAddressId_key" ON "email_job_dead_letter"("externalId", "inboxEmailAddressId");

-- CreateIndex
CREATE INDEX "email_attachments_emailMessageId_idx" ON "email_attachments"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "auto_reply_ledgers_automationId_inboxId_fromEmail_key" ON "auto_reply_ledgers"("automationId", "inboxId", "fromEmail");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_inboxes" ADD CONSTRAINT "phone_inboxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_inboxes" ADD CONSTRAINT "phone_inboxes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_inboxEmailAddressId_organizationId_fkey" FOREIGN KEY ("inboxEmailAddressId", "organizationId") REFERENCES "email_inboxes"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "email_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "automation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_revisions" ADD CONSTRAINT "automation_revisions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_revisions" ADD CONSTRAINT "automation_revisions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_organizationId_fkey" FOREIGN KEY ("automationId", "organizationId") REFERENCES "automations"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationRevisionId_fkey" FOREIGN KEY ("automationRevisionId") REFERENCES "automation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_node_runs" ADD CONSTRAINT "automation_node_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_job_dead_letter" ADD CONSTRAINT "email_job_dead_letter_inboxEmailAddressId_fkey" FOREIGN KEY ("inboxEmailAddressId") REFERENCES "email_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_ledgers" ADD CONSTRAINT "auto_reply_ledgers_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_ledgers" ADD CONSTRAINT "auto_reply_ledgers_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "email_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written SQL carried forward from the pre-UUIDv7 migration history.
-- Prisma's schema language cannot express any of the following, so they are
-- reapplied here rather than being lost when that history was squashed into
-- this baseline. The data-backfill statements from the old history are
-- deliberately NOT carried over: they existed to fix up pre-existing rows, and
-- a baseline always starts empty.
-- ---------------------------------------------------------------------------

-- Required for API key hashing.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- F14: partial OTP index. Partial because Prisma's schema cannot express a
-- WHERE predicate. It skips the majority of rows that carry no OTP and keeps
-- createdAt usable for ORDER BY (a plain 3-column index could not, because
-- extractedOtp sat between the equality and sort columns as an IS-NOT-NULL
-- range).
CREATE INDEX "email_messages_inbox_otp_partial_idx"
  ON "email_messages" ("inboxEmailAddressId", "createdAt" DESC)
  WHERE "extractedOtp" IS NOT NULL;

-- F9: partial index for the stuck-run sweeper, which filters
-- status IN ('queued','running') AND startedAt < cutoff. Only in-flight rows
-- are indexed, so it stays negligible on a high-growth table.
CREATE INDEX "automation_runs_status_startedat_partial_idx"
  ON "automation_runs" ("status", "startedAt")
  WHERE "status" IN ('queued', 'running');
