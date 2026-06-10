-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "extractedOtp" TEXT,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "email_messages_categories_idx" ON "email_messages" USING GIN ("categories");

-- CreateIndex
CREATE INDEX "email_messages_extractedOtp_idx" ON "email_messages"("extractedOtp");
