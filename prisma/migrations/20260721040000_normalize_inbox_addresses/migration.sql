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

-- Make a non-normalized address physically impossible. The goal is to mirror
-- `isValidInboxAddress`, whose charset rule is PRINTABLE_ASCII = /^[\x21-\x7e]+$/
-- — lowercase, and every character in printable ASCII (0x21–0x7e). Four clauses:
--   1. lowercase          `email = lower(email)`
--   2. ASCII only         `email !~ '[^[:ascii:]]'`   (codepoints 0x00–0x7f)
--   3. no whitespace       `email !~ '[[:space:]]'`    (rejects 0x20 space + 0x09–0x0d)
--   4. no control chars    `email !~ '[[:cntrl:]]'`    (rejects 0x00–0x1f, 0x7f)
--
-- Together, clauses 2–4 leave exactly 0x21–0x7e: ASCII, minus space, minus
-- control characters = printable ASCII. Clause 4 is the one that closes the gap
-- clauses 2–3 alone left open: an ASCII control character such as BEL (0x07) or
-- DEL (0x7f) is ASCII and is not whitespace, so it passed clauses 2 and 3 —
-- weaker than the app validator, which rejects it. (Clause 2 is stated as a
-- lowercase-preserving form rather than `email = lower(btrim(email, ...))`,
-- which would accept *interior* whitespace the app rejects.)
--
-- Why POSIX classes here and not the tempting `email ~ '^[[:graph:]]+$'`:
-- Postgres POSIX classes are LC_CTYPE-dependent. `[[:ascii:]]` is the exception
-- — it is defined as codepoints 0x00–0x7f regardless of locale — so clause 2 is
-- a locale-independent ASCII guarantee. `[[:graph:]]` is NOT: under a UTF-8
-- linguistic locale it also matches Unicode graphic characters, so
-- `~ '^[[:graph:]]+$'` would silently start *accepting* homoglyphs on a prod DB
-- with such a locale. Anchoring on `[[:ascii:]]` first restricts the string to
-- 0x00–0x7f, and within that range `[[:cntrl:]]` reliably means 0x00–0x1f/0x7f
-- in every locale, so clause 4 is safe. Verified on Postgres 14.19 (server
-- locale C); the reasoning is what keeps it correct on a differently-localed 17.
ALTER TABLE "email_inboxes"
  ADD CONSTRAINT "email_inboxes_email_normalized_check"
  CHECK (
    "email" = lower("email")
    AND "email" !~ '[^[:ascii:]]'
    AND "email" !~ '[[:space:]]'
    AND "email" !~ '[[:cntrl:]]'
  );
