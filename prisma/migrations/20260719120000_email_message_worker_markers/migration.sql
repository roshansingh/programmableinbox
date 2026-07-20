-- F19: per-step completion markers for the ingestion worker.
-- Nullable, no backfill: existing rows predate the worker's marker logic and are
-- never reprocessed (the worker only runs on new BullMQ jobs), so null is the
-- correct "step not run under the new scheme" value.
ALTER TABLE "email_messages"
  ADD COLUMN "dispatchedAt" TIMESTAMPTZ(3),
  ADD COLUMN "enrichedAt"   TIMESTAMPTZ(3);
