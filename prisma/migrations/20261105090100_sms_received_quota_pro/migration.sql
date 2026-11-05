-- Cap received SMS on the paid plan (issue #142). A phone number is a recurring
-- Twilio charge and each inbound segment is billed, so the paid plan is bounded.
-- Raising it later is a one-field UPDATE with no migration.
--
-- The cap is enforced even though `pro` has overQuotaBehavior = 'overage': that
-- setting means "bill the excess", which only email has (ee/plans/quota.ts keeps
-- `sms.received` hard-capped). Free has no key here and relies on its plan having
-- phoneInboxesEnabled = false, which makes ingestion drop every message for an
-- organization that lapsed to Free while still holding a number. The
-- `self_hosted` plan keeps its empty limits object, i.e. unlimited.
UPDATE "plans"
   SET "limits" = "limits" || '{"incomingSmsPerPeriod": 500}'::jsonb,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "code" = 'pro';
