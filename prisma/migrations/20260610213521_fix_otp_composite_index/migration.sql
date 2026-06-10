-- DropIndex
DROP INDEX "email_messages_extractedOtp_idx";

-- CreateIndex
CREATE INDEX "email_messages_inboxEmailAddressId_extractedOtp_createdAt_idx" ON "email_messages"("inboxEmailAddressId", "extractedOtp", "createdAt");
