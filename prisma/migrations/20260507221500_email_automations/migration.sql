-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'partial', 'skipped');

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inboxId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_revisions" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "layout" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "automationRevisionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "triggerType" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "inputSnapshot" JSONB NOT NULL,
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_node_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "configNodeId" TEXT NOT NULL,
    "configNodeType" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "branchTaken" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_node_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_reply_ledgers" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_reply_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automations_activeRevisionId_key" ON "automations"("activeRevisionId");

-- CreateIndex
CREATE INDEX "automations_organizationId_idx" ON "automations"("organizationId");

-- CreateIndex
CREATE INDEX "automations_inboxId_idx" ON "automations"("inboxId");

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
CREATE INDEX "email_attachments_emailMessageId_idx" ON "email_attachments"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "auto_reply_ledgers_automationId_inboxId_fromEmail_key" ON "auto_reply_ledgers"("automationId", "inboxId", "fromEmail");

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
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationRevisionId_fkey" FOREIGN KEY ("automationRevisionId") REFERENCES "automation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_node_runs" ADD CONSTRAINT "automation_node_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_ledgers" ADD CONSTRAINT "auto_reply_ledgers_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_ledgers" ADD CONSTRAINT "auto_reply_ledgers_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "email_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

