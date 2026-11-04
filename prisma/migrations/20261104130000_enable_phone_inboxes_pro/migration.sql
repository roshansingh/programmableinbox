-- Phone inboxes on the paid plan (issue #141).
--
-- Both hosted plans shipped with `phoneInboxesEnabled: false` because there was
-- nothing real behind the feature: the old flow let a user type in any number.
-- Provisioning now buys a real number from Twilio, so the paid plan gets it.
--
-- Pro: on, two numbers. Each is a real monthly charge on the platform's Twilio
-- account, which is why this is a small fixed count rather than unlimited.
-- Free stays off — it has no revenue to carry a per-number cost.
--
-- Merged into the existing object with `||` so every other limit on the row
-- (email inboxes, quota, overQuotaBehavior) is left exactly as it was. An UPDATE
-- rather than an INSERT ... ON CONFLICT: the plan rows already exist, and a
-- database with none matches zero rows and changes nothing.
--
-- The `self_hosted` plan is untouched; its empty limits object already means
-- unlimited, and phone inboxes default to enabled.
--
-- Only takes effect when COMMERCIAL_ENABLED=true and SMS_ENABLED=true. Raising or
-- lowering the count later is a one-field UPDATE with no migration.
UPDATE "plans"
   SET "limits" = "limits" || '{"phoneInboxesEnabled": true, "phoneInboxes": 2}'::jsonb,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "code" = 'pro';
