-- Cap received SMS on the paid plan (issue #142). A phone number is a recurring
-- Twilio charge and each inbound segment is billed, so the paid plan is bounded.
-- Raising it later is a one-field UPDATE with no migration.
--
-- Free has no phone inboxes, so it receives nothing and is left alone. The
-- `self_hosted` plan keeps its empty limits object, i.e. unlimited.
UPDATE "plans"
   SET "limits" = "limits" || '{"incomingSmsPerPeriod": 500}'::jsonb,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "code" = 'pro';
