-- Retire the `messages:delete` scope (2026-07-30 API split spec §5.3).
--
-- Table is "api_keys" (model ApiKey carries @@map). Column names stay
-- camelCase and therefore must be quoted.
--
-- Two cases, in this order:
--
-- 1. Keys holding `messages:delete` alongside read scopes: strip it.
-- 2. Keys holding ONLY `messages:delete`: stripping would leave an empty
--    array, so the key would authenticate but authorize nothing — every
--    request failing 403 in a way that reads like a config error rather
--    than a deliberate change. Backfill those to the read scopes instead.
--    This is a narrowing in every case, since delete is going away regardless.

-- Case 2 first: identify single-scope keys before the strip removes the evidence.
UPDATE "api_keys"
SET "scopes" = ARRAY['inboxes:read', 'messages:read']
WHERE "scopes" = ARRAY['messages:delete'];

-- Case 1: strip the scope wherever it remains.
UPDATE "api_keys"
SET "scopes" = array_remove("scopes", 'messages:delete')
WHERE 'messages:delete' = ANY("scopes");

-- Safety net: no active key should be left unable to do anything. `scopes` is
-- nullable at the database level (TEXT[] DEFAULT ARRAY[]::TEXT[], no NOT NULL),
-- and a NULL is as unusable as an empty array, so coalesce rather than testing
-- cardinality alone — `cardinality(NULL) = 0` is NULL, not true, and would skip
-- exactly the rows this is meant to rescue.
UPDATE "api_keys"
SET "scopes" = ARRAY['inboxes:read', 'messages:read']
WHERE coalesce(cardinality("scopes"), 0) = 0
  AND "revokedAt" IS NULL;
