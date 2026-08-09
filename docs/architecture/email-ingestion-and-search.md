# Email ingestion, threading, and search

## Ingestion (Resend webhook)

`app/api/webhooks/email/route.ts` receives `email.received` events from Resend.

- **Validation**: `x-webhook-signature` + `x-webhook-timestamp` headers, checked against
  `WEBHOOK_SECRET` with `crypto.timingSafeEqual`, inside a 5-minute replay window.
- **Threading** (`determineThreading`): first tries to match `In-Reply-To` / `References`
  headers against a known `EmailMessage.messageId`; if that fails, falls back to a subject match
  (`Re:`/`Fwd:` stripped) within the same inbox. A new thread's `threadId` is the new message's
  own database id. The subject fallback exists because Resend's outgoing `Message-ID` doesn't
  always match what the recipient's mail client actually sent back — don't remove it as dead
  code.
- **Duplicates** are skipped silently via Prisma's `P2002` unique-constraint error on
  `(externalId, inboxEmailAddressId)`.
- Ingestion can run synchronously (default) or through a BullMQ/Redis queue for faster webhook
  responses — see [async-webhook-processing.md](async-webhook-processing.md).

## Message search

Four query parameters, shared by both `GET /api/app/emailInbox/[id]/messages` and
`GET /api/v1/emailInbox/{id}/messages`: `q` (full-text over subject and body), `from`
(case-insensitive substring), `tags` and `categories` (exact match, OR within a parameter, AND
across parameters). Both routes parse through the same function,
`lib/search/message-search-params.ts`, so the public API contract and the dashboard can't quietly
drift on what a parameter means.

**Search filters; it doesn't rank.** Results stay ordered `createdAt DESC, id DESC`, so the
existing keyset cursor keeps working with a `?q=` added to the query string — no second
pagination contract to design. Relevance ranking (`ts_rank`) would need a float in the cursor and
is deliberately out of scope for now.

**`grouped=true` combined with any search parameter is a 400.** Grouped mode collapses to one row
per thread; every plausible answer to "what does it mean for a *thread* to match a search term"
either changes what a thread's message count means or returns a row that doesn't itself contain
the term. The dashboard's list view defaults to grouped, so a search UI has to explicitly ask for
`grouped=false`.

### How the index is built

- **`EmailMessage.bodyText`** holds the searchable plain text — the sender's `text` part when
  Resend provides one, otherwise text extracted from `html` via `lib/email/extract-body-text.ts`
  (the `html-to-text` package, not a regex tag-stripper — a real parser matters because templated
  marketing email carries multi-kilobyte `<style>` blocks that a regex would happily index as
  searchable content).
- **`EmailMessage.searchVector` is a STORED generated column**, computed by Postgres at insert
  time from `coalesce(bodyText, text, '')`, not written by the application and not recomputed by
  a trigger. That means the index can't drift from the row it describes.
  - `to_tsvector` is called with an explicit `'english'::regconfig`. The one-argument form
    resolves the server's default config at call time, which Postgres won't allow inside a
    generated column expression (it has to be provably immutable).
  - The indexed text is capped (`left(...)`, matching `MAX_BODY_TEXT_LENGTH` in application code).
    `to_tsvector` raises once a vector exceeds roughly 1MB, and a generated column is computed
    during `INSERT` — without the cap, an oversized email wouldn't just be unsearchable, it would
    fail to ingest at all.
- Existing rows were **not backfilled** when the column was introduced — the migration recomputed
  the vector for every row from what was already stored, so subject search covers all historical
  mail immediately, and body search covers everything that arrived with a `text` part. Only the
  bodies of pre-existing HTML-only mail are missing from search until re-ingested or backfilled.

### Why the query is raw SQL

`lib/services/message-search.ts` builds the search query directly rather than through Prisma's
query builder, because Prisma's `search` operator needs a preview flag, compiles to
`to_tsquery` (which *throws* on input like a stray `&`, turning a search box into a 500), and
can't reference an `Unsupported` column type at all. `websearch_to_tsquery` is total — it never
raises — and gives callers `"quoted phrases"`, `or`, and `-negation` syntax for free. Two things
the raw SQL has to do by hand that the ORM would otherwise do automatically:

- **`deletedAt IS NULL`** — raw SQL bypasses the soft-delete extension in `lib/db.ts`, so this
  filter has to be written explicitly or search would serve deleted messages.
- **`from` is LIKE-escaped** (`\`, `%`, `_`) — an unescaped `from=%` would otherwise match every
  row.

`MESSAGE_COLUMNS` (`lib/services/message-columns.ts`) exists specifically to keep `searchVector`
out of any `SELECT *` — a tsvector over a 100k-character body is roughly 220KB, and no serializer
ever reads that column, so including it in a page of results would be pure waste.

## Related

- [async-webhook-processing.md](async-webhook-processing.md) — the optional queue-backed
  ingestion path
- [mcp-server.md](mcp-server.md) — `pibx_email_search_messages` is a third caller of the same
  search parser
