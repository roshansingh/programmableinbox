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
BEGIN
  SELECT string_agg(normalized, ', ' ORDER BY normalized)
    INTO collisions
    FROM (
      SELECT lower(btrim("email")) AS normalized
        FROM "email_inboxes"
       GROUP BY lower(btrim("email"))
      HAVING count(*) > 1
    ) AS dupes;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalize email_inboxes.email: addresses collide after lowercasing/trimming: %. '
      'Resolve by hand — decide which organization keeps each address, then soft-delete or '
      're-point the others — and re-run this migration.', collisions;
  END IF;
END $$;

-- Step 2: canonicalize existing rows.
UPDATE "email_inboxes"
   SET "email" = lower(btrim("email"))
 WHERE "email" <> lower(btrim("email"));

-- Step 3: make a non-normalized address physically impossible.
--
-- NOT VALID is deliberately not used: the table is small and every existing row
-- was just normalized by step 2, so a full validating scan is cheap and gives
-- the guarantee immediately rather than leaving pre-existing rows exempt.
ALTER TABLE "email_inboxes"
  ADD CONSTRAINT "email_inboxes_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
