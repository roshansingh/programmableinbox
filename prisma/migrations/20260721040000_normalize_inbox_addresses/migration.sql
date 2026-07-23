-- Normalize inbox receiving addresses (F1 / issue #37).
--
-- `email_inboxes_email_key` is a byte-exact unique index, but inbound routing
-- lowercases the recipient before matching it. Case variants therefore occupy
-- two rows but resolve to one address, which lets a second tenant claim
-- `Billing@corp.com` while `billing@corp.com` is in use and intercept its mail.
--
-- This migration canonicalizes existing addresses and then pins the invariant
-- with a CHECK constraint, so the existing unique index becomes a genuine
-- one-address-one-inbox guarantee. It is written by hand: the CHECK is not
-- expressible in schema.prisma, and the guarded backfill below cannot be
-- generated.

-- Step 1: refuse to proceed if normalizing would collide.
--
-- Chosen strategy: FAIL LOUDLY. The alternative — keeping the oldest row per
-- normalized address — would silently pick a winner between two tenants and
-- either orphan an inbox's messages or leave a tenant's mail routing to
-- someone else. That is a security-relevant call an operator must make with
-- knowledge of who legitimately owns the address, not one a migration should
-- make in the dark. Collisions are only possible between case/whitespace
-- variants (exact duplicates are already impossible under the unique index),
-- so this is expected to be empty in practice.
DO $$
DECLARE
  collisions TEXT;
  unroutable TEXT;
  non_ascii  TEXT;
BEGIN
  -- Single-argument btrim() strips ONLY spaces. The router uses JS `.trim()`,
  -- which strips tabs, newlines, CR, FF and VT as well, so a space-only trim
  -- here would leave the DB invariant weaker than the routing behaviour it is
  -- supposed to pin. Trim the same ASCII whitespace set explicitly.
  SELECT string_agg(normalized, ', ' ORDER BY normalized)
    INTO collisions
    FROM (
      SELECT lower(btrim("email", E' \t\n\r\f\v')) AS normalized
        FROM "email_inboxes"
       GROUP BY lower(btrim("email", E' \t\n\r\f\v'))
      HAVING count(*) > 1
    ) AS dupes;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalize email_inboxes.email: addresses collide after lowercasing/trimming: %. '
      'Resolve by hand — decide which organization keeps each address, then soft-delete or '
      're-point the others — and re-run this migration.', collisions;
  END IF;

  -- A valid receiving address contains no whitespace at all: `isValidInboxAddress`
  -- rejects it (ADDRESS_PATTERN is /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/), and an
  -- address with an interior space can never match a recipient anyway. Trimming
  -- cannot fix such a row, so fail loudly rather than storing something the
  -- CHECK below would reject with an opaque constraint-violation message.
  SELECT string_agg(DISTINCT "email", ', ')
    INTO unroutable
    FROM "email_inboxes"
   WHERE btrim("email", E' \t\n\r\f\v') ~ '[[:space:]]';

  IF unroutable IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalize email_inboxes.email: addresses contain interior whitespace and are '
      'unroutable: %. These can never receive mail; delete or correct them and re-run.', unroutable;
  END IF;

  -- A receiving address must be printable ASCII (see `isValidInboxAddress`).
  -- Non-ASCII enables homoglyph confusables (Cyrillic vs Latin) and invisible
  -- characters; lowercasing does not fold it away, so such a row cannot pass the
  -- CHECK below. Fail loudly rather than with an opaque constraint violation.
  SELECT string_agg(DISTINCT "email", ', ')
    INTO non_ascii
    FROM "email_inboxes"
   WHERE "email" ~ '[^[:ascii:]]';

  IF non_ascii IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalize email_inboxes.email: addresses contain non-ASCII characters: %. '
      'These are not valid receiving addresses; delete or correct them and re-run.', non_ascii;
  END IF;
END $$;

-- Step 2: canonicalize existing rows.
UPDATE "email_inboxes"
   SET "email" = lower(btrim("email", E' \t\n\r\f\v'))
 WHERE "email" <> lower(btrim("email", E' \t\n\r\f\v'));

-- Step 3: make a non-normalized address physically impossible.
--
-- Three clauses, mirroring `isValidInboxAddress`:
--   1. lowercase (`email = lower(email)`);
--   2. no whitespace of any kind (`email !~ '[[:space:]]'`);
--   3. printable ASCII only (`email !~ '[^[:ascii:]]'`).
--
-- Clause 2 is stated directly rather than as `email = lower(btrim(email, ...))`:
-- the btrim form accepts *interior* whitespace (nothing to trim, so it equals
-- itself), which the application rejects. Clause 3 closes the gap that the app's
-- ASCII-only rule would otherwise be stricter than the DB — POSIX `[[:space:]]`
-- matches only ASCII whitespace, so a Unicode space like U+00A0, or any other
-- non-ASCII character (homoglyphs, zero-width spaces), would slip past clauses 1
-- and 2. `[[:ascii:]]` matches only codepoints 0x00–0x7f, so `[^[:ascii:]]`
-- catches everything above it. Together the three keep this constraint at least
-- as strict as `isValidInboxAddress`, so a row written by raw SQL or a future
-- write path cannot be weaker than one written through a route.
--
-- NOT VALID is deliberately not used: the table is small and every existing row
-- was just normalized by step 2, so a full validating scan is cheap and gives
-- the guarantee immediately rather than leaving pre-existing rows exempt.
ALTER TABLE "email_inboxes"
  ADD CONSTRAINT "email_inboxes_email_normalized_check"
  CHECK (
    "email" = lower("email")
    AND "email" !~ '[[:space:]]'
    AND "email" !~ '[^[:ascii:]]'
  );
