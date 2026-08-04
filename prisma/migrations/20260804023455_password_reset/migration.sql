-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "passwordResetEmailSentAt" TIMESTAMPTZ(3);
