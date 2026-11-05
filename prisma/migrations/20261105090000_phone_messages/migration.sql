-- Inbound SMS (issue #142). Receive-only, so no direction/status columns.
CREATE TABLE "phone_messages" (
    "id"             UUID NOT NULL,
    "phoneInboxId"   UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "from"           TEXT NOT NULL,
    "to"             TEXT NOT NULL,
    "body"           TEXT NOT NULL,
    "mediaCount"     INTEGER NOT NULL DEFAULT 0,
    "externalId"     TEXT NOT NULL,
    "threadId"       TEXT NOT NULL,
    "extractedOtp"   TEXT,
    "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"      TIMESTAMPTZ(3),

    CONSTRAINT "phone_messages_pkey" PRIMARY KEY ("id")
);

-- Twilio re-sends a delivery under the same MessageSid; this is the dedupe key.
CREATE UNIQUE INDEX "phone_messages_externalId_phoneInboxId_key" ON "phone_messages"("externalId", "phoneInboxId");
CREATE INDEX "phone_messages_phoneInboxId_createdAt_idx" ON "phone_messages"("phoneInboxId", "createdAt");
CREATE INDEX "phone_messages_threadId_createdAt_idx" ON "phone_messages"("threadId", "createdAt");
CREATE INDEX "phone_messages_organizationId_idx" ON "phone_messages"("organizationId");

ALTER TABLE "phone_messages" ADD CONSTRAINT "phone_messages_phoneInboxId_fkey"
  FOREIGN KEY ("phoneInboxId") REFERENCES "phone_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_messages" ADD CONSTRAINT "phone_messages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
