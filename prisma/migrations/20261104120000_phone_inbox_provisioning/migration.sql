-- Real number provisioning for phone inboxes (issue #141).
--
-- Hand-written rather than generated: the partial unique index below cannot be
-- expressed in Prisma's schema language (see the note on PhoneInbox.deletedAt).

CREATE TYPE "PhoneInboxStatus" AS ENUM ('pending', 'active', 'released', 'failed');

ALTER TABLE "phone_inboxes"
  ADD COLUMN "twilioSid"    TEXT,
  ADD COLUMN "status"       "PhoneInboxStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "capabilities" JSONB,
  ADD COLUMN "releasedAt"   TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "phone_inboxes_twilioSid_key" ON "phone_inboxes"("twilioSid");

-- Backfill, BEFORE the index exists. Every row that predates this migration was
-- typed in by hand: no Twilio call, no ownership check, and nothing uniquely
-- constrained, so two organizations may hold the same string. None of them is a
-- number we own. They are marked released rather than deleted so nothing is
-- destroyed; the app lists only pending and active rows.
UPDATE "phone_inboxes"
   SET "status" = 'released', "releasedAt" = now()
 WHERE "twilioSid" IS NULL;

-- One live holder per number, across all organizations.
--
-- Partial on purpose, and on `status` rather than `deletedAt`:
--   * released: handed back to Twilio, legitimately re-buyable by anyone.
--   * failed:   never held a number; must not block a retry.
--   * pending:  a reservation made before the Twilio purchase, so two requests
--               racing for one number collide here instead of both paying.
-- A row soft-deleted but still `active` keeps holding the number, because the
-- number is still ours at Twilio until it is released.
CREATE UNIQUE INDEX "phone_inboxes_phoneNumber_live_key"
  ON "phone_inboxes"("phoneNumber")
  WHERE "status" IN ('pending', 'active');
