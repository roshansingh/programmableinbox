-- Full-text search on email messages (issue #106).
--
-- Hand-written rather than generated: `searchVector` is a STORED generated column,
-- which Prisma's schema language cannot express (it is declared there as
-- `Unsupported("tsvector")?` so the client knows the column exists and never reads
-- or writes it).

-- Derived plain text of the body. Written at ingest by lib/email/extract-body-text.ts.
-- Nullable, and deliberately not backfilled — the generated column below falls back
-- to `text`, so only the bodies of pre-existing HTML-only mail are missing.
ALTER TABLE "email_messages" ADD COLUMN "bodyText" TEXT;

-- The search vector.
--
-- Three things here are load-bearing and must not be "simplified":
--
-- 1. `to_tsvector` is called with an explicit `'english'::regconfig`. The
--    single-argument form resolves `default_text_search_config` at call time and is
--    therefore STABLE, not IMMUTABLE; Postgres rejects it outright in a generated
--    column expression.
--
-- 2. The `left(...)` caps are a correctness bound, not a size preference.
--    `to_tsvector` raises an error once the resulting vector exceeds 1 MB, and a
--    generated column is computed during INSERT — so without these an oversized
--    email would not merely be unsearchable, it would fail ingestion. The body cap
--    matches MAX_BODY_TEXT_LENGTH in lib/email/extract-body-text.ts; keeping it here
--    too means the guarantee does not depend on the application layer behaving.
--
-- 3. `coalesce("bodyText", text, '')` is what makes this work for existing rows
--    without a backfill: mail that arrived with a sender-supplied text part stays
--    fully searchable, and every row's subject is indexed by the table rewrite this
--    statement performs.
--
-- Weights: subject A, body B, so a future ts_rank ordering can prefer subject hits
-- without another migration. Nothing reads the weights today.
ALTER TABLE "email_messages" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, left(coalesce("subject", ''), 10000)), 'A') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce("bodyText", "text", ''), 100000)), 'B')
  ) STORED;

CREATE INDEX "email_messages_searchVector_idx" ON "email_messages" USING GIN ("searchVector");

-- `categories` already had a GIN index; `tags` is filterable on the same terms now
-- and did not.
CREATE INDEX "email_messages_tags_idx" ON "email_messages" USING GIN ("tags");
