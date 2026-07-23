-- Constrain inbox receiving addresses to their canonical form (F1 / issue #37).
--
-- `email_inboxes_email_key` (from the init migration) is a byte-exact unique
-- index, but inbound routing lowercases the recipient before matching it. Case
-- variants therefore occupy two rows but resolve to one address, which lets a
-- second tenant claim `Billing@corp.com` while `billing@corp.com` is in use and
-- intercept its mail. The application already normalizes on every write
-- (`lib/email-address.ts`); this CHECK pins that invariant at the database layer
-- so a writer that bypasses the app (a seed, a future route, raw SQL) cannot
-- store a row that would defeat the unique index. It is written by hand because
-- a CHECK constraint is not expressible in schema.prisma.
--
-- No backfill. The app is pre-launch with no inbox rows, so there is nothing to
-- canonicalize, and a fresh `migrate deploy` adds the constraint to an empty
-- table. If this ever has to run against populated data, ADD CONSTRAINT will
-- fail loudly on any non-conforming row (the safe direction) — that is the
-- signal to prepend a guarded backfill; see git history on this file for one.

-- Make a non-normalized address physically impossible. Three clauses, mirroring
-- `isValidInboxAddress`:
--   1. lowercase (`email = lower(email)`);
--   2. no whitespace of any kind (`email !~ '[[:space:]]'`);
--   3. printable ASCII only (`email !~ '[^[:ascii:]]'`).
--
-- Clause 2 is stated directly rather than as `email = lower(btrim(email, ...))`:
-- the btrim form accepts *interior* whitespace (nothing to trim, so it equals
-- itself), which the application rejects. Clause 3 keeps the constraint at least
-- as strict as the app's ASCII-only rule — POSIX `[[:space:]]` matches only
-- ASCII whitespace, so a Unicode space like U+00A0, or any other non-ASCII
-- character (homoglyphs, zero-width spaces), would slip past clauses 1 and 2.
-- `[[:ascii:]]` matches only codepoints 0x00–0x7f, so `[^[:ascii:]]` catches
-- everything above it.
ALTER TABLE "email_inboxes"
  ADD CONSTRAINT "email_inboxes_email_normalized_check"
  CHECK (
    "email" = lower("email")
    AND "email" !~ '[[:space:]]'
    AND "email" !~ '[^[:ascii:]]'
  );
