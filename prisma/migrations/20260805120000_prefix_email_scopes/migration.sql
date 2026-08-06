-- Prefix the API key scopes with their domain, ahead of SMS support.
--
--   inboxes:read  -> email_inboxes:read
--   messages:read -> email_messages:read
--
-- `PhoneInbox` already exists in the schema with its own internal route tree.
-- Once it reaches the external surface, an unprefixed `inboxes:read` either
-- silently widens to grant phone inboxes too, or gets renamed then instead —
-- the same break, with more keys in the wild.
--
-- Table is "api_keys" (model ApiKey carries @@map). Column names stay camelCase
-- and therefore must be quoted.
--
-- This is a rename, NOT a grant. No row gains a mutating scope here
-- (`email_inboxes:create`, `:update` or `:delete`). Each of those must only
-- ever be held by a key whose creator chose it, and `:delete` in particular
-- retires an address permanently. `LEGACY_SCOPE_ALIASES` in
-- lib/api-key-scopes.ts maps the old read names forward for the duration of the
-- rollout, and it deliberately has no entry pointing at any mutating scope.

-- array_replace rewrites in place, so a key holding both scopes keeps both and
-- ordering is preserved. Guarded by the ANY(...) predicate rather than run
-- unconditionally so the statement touches only rows that need it.
UPDATE "api_keys"
SET "scopes" = array_replace("scopes", 'inboxes:read', 'email_inboxes:read')
WHERE 'inboxes:read' = ANY("scopes");

UPDATE "api_keys"
SET "scopes" = array_replace("scopes", 'messages:read', 'email_messages:read')
WHERE 'messages:read' = ANY("scopes");

-- Safety net, carried over from the messages:delete retirement. `scopes` is
-- nullable at the database level (TEXT[] DEFAULT ARRAY[]::TEXT[], no NOT NULL),
-- and a NULL is as unusable as an empty array — a key that authenticates but
-- authorizes nothing fails every request in a way that reads as a config error.
-- Coalesce rather than testing cardinality alone: `cardinality(NULL) = 0` is
-- NULL, not true, and would skip exactly the rows this is meant to rescue.
--
-- Backfills the read scopes only. Rescuing a key must not be a way to acquire
-- write access.
UPDATE "api_keys"
SET "scopes" = ARRAY['email_inboxes:read', 'email_messages:read']
WHERE coalesce(cardinality("scopes"), 0) = 0
  AND "revokedAt" IS NULL;
