-- CreateTable
CREATE TABLE "email_job_dead_letter" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "inboxEmailAddressId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_job_dead_letter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_job_dead_letter_inboxEmailAddressId_idx" ON "email_job_dead_letter"("inboxEmailAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "email_job_dead_letter_externalId_inboxEmailAddressId_key" ON "email_job_dead_letter"("externalId", "inboxEmailAddressId");

-- AddForeignKey
ALTER TABLE "email_job_dead_letter" ADD CONSTRAINT "email_job_dead_letter_inboxEmailAddressId_fkey" FOREIGN KEY ("inboxEmailAddressId") REFERENCES "email_inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
