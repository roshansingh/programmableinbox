-- Email verification at signup (issue #102).

-- Resend cooldown timestamp. Nullable: a user who has never been mailed has no
-- last-send instant, and NULL reads as "no cooldown in effect".
ALTER TABLE "users" ADD COLUMN "verificationEmailSentAt" TIMESTAMPTZ(3);

-- Grandfather every account that predates the feature.
--
-- The flag applies to new signups only. Without this line, flipping
-- ENABLE_EMAIL_VERIFICATION on locks out the entire existing userbase at once,
-- because `emailVerified` has been written by nothing since it was added.
--
-- Safe to run unconditionally, whatever ENABLE_EMAIL_VERIFICATION is set to:
-- with the flag off, `emailVerified` is read by nothing but the response
-- serializer.
--
-- Accepted trade-off: addresses that were never proven are now marked proven.
-- Forcing the current userbase through a link was judged too disruptive for the
-- value. A deployment that wants the strict version runs the reverse UPDATE
-- itself before enabling the flag — an operator action, not a product default.
UPDATE "users" SET "emailVerified" = true WHERE "emailVerified" = false;
